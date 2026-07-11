import "server-only";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import type { CostTracker } from "./cost-tracker";
import { formatTranscript, type TranscriptSegment } from "./transcribe";

/** Media metadata passed into Agent 1 (images and video thumbnails). */
export type UploadedImage = {
  path: string;
  signedUrl: string;
  mimeType: string | null;
  fileSize: number | null;
  /** "image" or "video" — set for reel pipeline so agents know the source type. */
  mediaType?: "image" | "video";
  /** Video duration in seconds — only set for video uploads. */
  durationSec?: number;
};

/** A curated media item from Agent 1's shortlist. */
export type CuratedImage = {
  path: string;
  relevanceScore: number;
  description: string;
  quality: "high" | "medium" | "low";
  /** "image" or "video" — echoed from input so Agent 2 knows the media type. */
  mediaType?: "image" | "video";
  /** Video duration in seconds — only set for videos. */
  durationSec?: number;
  /** For videos: suggested trim start (seconds). */
  suggestedTrimStart?: number;
  /** For videos: suggested trim end (seconds). */
  suggestedTrimEnd?: number;
  /** For videos: true if the trim window contains spoken words (per the transcript)
   *  — so the composition plays the clip's own audio and ducks the music. */
  containsSpeech?: boolean;
};

/** Agent 1 output — stored in ai_generation_jobs.agent1_output. */
export type UnderstandingOutput = {
  theme: string;
  coreMessage: string;
  curatedImages: CuratedImage[];
  rejectedImages: { path: string; reason: string }[];
  audience: string;
  tone: string;
  constraints: string[];
};

type Agent1Input = {
  title: string;
  description: string | null;
  images: UploadedImage[];
  brandAssetTypes: string[];
  schoolGuidelines?: string | null;
  /** Max curated items. Default 15 (posters). For reels, pass a higher value
   *  based on requested duration (e.g., 180s reel needs ~36 items at 5s each). */
  maxShortlist?: number;
  /** Per-video timestamped transcripts (Whisper), keyed by video path. Lets the
   *  agent pick segments by spoken content and split long videos into scenes. */
  videoTranscripts?: Record<string, TranscriptSegment[]>;
};

const DEFAULT_MAX_SHORTLIST = 15;

/**
 * Two-pass image analysis:
 *
 * Pass 1 (quick scan): All images at detail:"low" (~85 tokens each).
 *   Quick relevance + quality filter. Returns top 15-20 paths.
 *
 * Pass 2 (deep analysis): Only the shortlisted images at detail:"high" (~1100 tokens each).
 *   Detailed descriptions, precise quality assessment, final ranking.
 *
 * This avoids context dilution from 60-70 high-detail images in one call.
 */
export async function runUnderstandingAgent(
  input: Agent1Input,
  costTracker?: CostTracker,
): Promise<UnderstandingOutput> {
  const openai = await getModelClient();

  const MAX_SHORTLIST = input.maxShortlist ?? DEFAULT_MAX_SHORTLIST;

  const contextText = `Title: ${input.title}\n\nDescription: ${input.description ?? "(none provided)"}\n\nSchool brand asset types available: ${input.brandAssetTypes.join(", ") || "none"}${input.schoolGuidelines ? `\n\nSchool-specific guidelines:\n${input.schoolGuidelines}` : ""}`;

  // If fewer items than the shortlist cap, skip pass 1 and go straight to deep analysis
  if (input.images.length <= MAX_SHORTLIST) {
    return deepAnalysis(openai, input.images, contextText, costTracker, input.videoTranscripts);
  }

  // ---------------------------------------------------------------
  // Pass 1: Quick scan at low detail — filter down to top 15-20
  // ---------------------------------------------------------------
  const pass1Content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: `${contextText}\n\nTotal images: ${input.images.length}\n\nQuickly scan ALL images below. For each one, give a relevance score (0-100) based on the title/description. Return ONLY valid JSON:\n{"shortlist": [{"path": "string", "score": 0-100, "reason": "brief reason"}], "rejected": [{"path": "string", "reason": "brief reason"}]}\n\nShortlist the top ${MAX_SHORTLIST} most relevant, high-quality images. Reject the rest.`,
    },
  ];

  const pass1IntroducedVideos = new Set<string>();
  for (const img of input.images) {
    if (img.mediaType === "video") {
      // Skip video frames without a signedUrl
      if (!img.signedUrl) continue;
      if (!pass1IntroducedVideos.has(img.path)) {
        pass1IntroducedVideos.add(img.path);
        pass1Content.push({
          type: "text",
          text: `[VIDEO: ${img.path} — ${img.durationSec ?? "?"}s clip, frames below:]`,
        });
      }
      pass1Content.push({
        type: "image_url",
        image_url: { url: img.signedUrl, detail: "low" },
      });
      const ts = (img as unknown as Record<string, unknown>)._frameTimestamp as number | undefined;
      pass1Content.push({ type: "text", text: `[~${ts ?? "?"}s]` });
    } else {
      pass1Content.push({
        type: "image_url",
        image_url: { url: img.signedUrl, detail: "low" },
      });
      pass1Content.push({ type: "text", text: `[${img.path}]` });
    }
  }

  const pass1Response = await withRateLimitRetry(() =>
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a quick image scanner for school marketing posters. Rapidly assess each image for relevance and quality. Be decisive — reject blurry, irrelevant, or duplicate images immediately.",
        },
        { role: "user", content: pass1Content },
      ],
      response_format: { type: "json_object" },
      max_tokens: 4096,
    }),
  );

  costTracker?.addLLMCall("agent1_pass1", "gpt-4o-mini", pass1Response.usage);

  const pass1Raw = pass1Response.choices[0]?.message?.content;
  if (!pass1Raw) throw new Error("Agent 1 Pass 1: empty response");

  let shortlistedPaths: string[];
  try {
    const pass1Result = JSON.parse(pass1Raw) as {
      shortlist: { path: string; score: number }[];
      rejected: { path: string; reason: string }[];
    };
    // Sort by score descending, take top MAX_SHORTLIST
    shortlistedPaths = pass1Result.shortlist
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SHORTLIST)
      .map((s) => s.path);
  } catch {
    // If pass 1 fails to parse, take all images (fallback)
    shortlistedPaths = input.images.slice(0, MAX_SHORTLIST).map((i) => i.path);
  }

  // Filter to shortlisted images only
  const shortlistedImages = input.images.filter((img) => {
    const imgFilename = img.path.split("/").pop() ?? "";
    return shortlistedPaths.some(
      (p) => p === img.path || img.path.endsWith(p) || p.endsWith(imgFilename),
    );
  });

  // If no images made the cut, take the first few as fallback
  if (shortlistedImages.length === 0) {
    return deepAnalysis(openai, input.images.slice(0, MAX_SHORTLIST), contextText, costTracker, input.videoTranscripts);
  }

  // ---------------------------------------------------------------
  // Pass 2: Deep analysis at high detail — only shortlisted images
  // ---------------------------------------------------------------
  return deepAnalysis(openai, shortlistedImages, contextText, costTracker, input.videoTranscripts);
}

async function deepAnalysis(
  openai: Awaited<ReturnType<typeof getModelClient>>,
  images: UploadedImage[],
  contextText: string,
  costTracker?: CostTracker,
  videoTranscripts?: Record<string, TranscriptSegment[]>,
): Promise<UnderstandingOutput> {
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = [
    {
      type: "text",
      text: `${contextText}\n\nAnalyze the following ${images.length} images in detail.`,
    },
  ];

  // Group video frames by path so we can label them as a sequence
  const videoFramesByPath = new Map<string, typeof images>();
  for (const img of images) {
    if (img.mediaType === "video") {
      const existing = videoFramesByPath.get(img.path) ?? [];
      existing.push(img);
      videoFramesByPath.set(img.path, existing);
    }
  }

  // Track which video paths we've already introduced
  const introducedVideos = new Set<string>();

  for (const img of images) {
    if (img.mediaType === "video") {
      const frames = videoFramesByPath.get(img.path) ?? [];
      const frameIdx = frames.indexOf(img);
      const timestamp = (img as unknown as Record<string, unknown>)._frameTimestamp as number | undefined;

      // Introduce the video on its first frame
      if (!introducedVideos.has(img.path)) {
        introducedVideos.add(img.path);
        const transcript = videoTranscripts?.[img.path];
        const transcriptBlock = transcript?.length
          ? `\nTRANSCRIPT (timestamped — use this to find the meaningful moments and align trim windows to what is said):\n${formatTranscript(transcript)}`
          : "";
        userContent.push({
          type: "text",
          text: `\n── VIDEO: ${img.path} (${img.durationSec ?? "?"}s clip, ${frames.length} frames sampled every 2s) ──\nAnalyze ALL frames below to understand what happens throughout this video. Describe the action, movement, people, and setting.${transcriptBlock}\n\nIf this is a LONG video (more than ~15s) containing several distinct moments, return MULTIPLE curated entries for it — one per moment — each with the SAME path but a DIFFERENT suggestedTrimStart/suggestedTrimEnd window (each window 4-8s). For a short clip, return a single best segment.`,
        });
      }

      userContent.push({
        type: "image_url",
        image_url: { url: img.signedUrl, detail: "high" },
      });
      userContent.push({
        type: "text",
        text: `[Frame ${frameIdx + 1}/${frames.length} at ~${timestamp ?? "?"}s]`,
      });
    } else {
      userContent.push({
        type: "image_url",
        image_url: { url: img.signedUrl, detail: "high" },
      });
      userContent.push({ type: "text", text: `[Image: ${img.path}]` });
    }
  }

  const response = await withRateLimitRetry(() => openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are an expert visual content analyst for school marketing materials (posters and video reels).

Your job is to:
1. Understand the theme, audience, and tone from the title and description.
2. Analyze every image AND video frame for quality, composition, content, and relevance to the theme.
3. Curate a shortlist of the best media (the ${images.length} below are already pre-filtered — keep every clearly relevant, high-quality item; do not trim below what genuinely fits) ranked by relevance.
4. Reject media that is blurry, irrelevant, or low quality — explain why.
5. For each curated item, write a detailed description of what's in it (people, setting, action, mood).
6. Identify the core message that should come through in the output.

IMPORTANT — VIDEO FRAMES:
- Items labeled "[VIDEO FRAME: ...]" are thumbnails extracted from video clips, NOT static photos.
- Describe the VIDEO CONTENT: what action/movement is happening, the setting, the mood.
- For videos, include "mediaType": "video" and "durationSec" (from the label) in your output.
- For videos, suggest the most interesting trim window: "suggestedTrimStart" and "suggestedTrimEnd" in seconds.
  If the video is short (under ~15s), return ONE entry using the full clip or the best 3-8s segment.
- LONG videos (over ~15s, e.g. a montage of multiple moments) should yield MULTIPLE curated entries:
  emit one entry per distinct moment, each with the SAME "path" but a DIFFERENT 4-8s
  suggestedTrimStart/suggestedTrimEnd window. Use the timestamped TRANSCRIPT (when provided) and the
  frames to choose windows that land on meaningful moments (a quote, an action, a reaction) and spread
  them across the clip. This lets one long video become several scenes.
- SPEECH: for each video entry, set "containsSpeech": true if its trim window overlaps spoken words in
  the TRANSCRIPT (someone is talking — an interview answer, a statement, a dialogue). Set false for
  silent action / b-roll / music-only footage. This drives the audio mix (the composition will let the
  speaker's voice play and duck the background music during these segments). If no transcript is
  provided, infer from the frames (people clearly mid-speech) and default to false when unsure.
- For regular photos, include "mediaType": "image" (no duration/trim fields needed).

Return ONLY valid JSON matching this schema:
{
  "theme": "string — the central theme/topic",
  "coreMessage": "string — the key message",
  "curatedImages": [{ "path": "string", "relevanceScore": 0-100, "description": "detailed description", "quality": "high|medium|low", "mediaType": "image|video", "durationSec": number_or_null, "suggestedTrimStart": number_or_null, "suggestedTrimEnd": number_or_null, "containsSpeech": true_or_false }],
  "rejectedImages": [{ "path": "string", "reason": "string" }],
  "audience": "string — target audience (parents, students, community, etc.)",
  "tone": "string — visual tone (celebratory, informational, urgent, etc.)",
  "constraints": ["string — any constraints or notes for the designer"]
}`,
      },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
  }));

  costTracker?.addLLMCall("agent1_pass2", "gpt-4o-mini", response.usage);

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Agent 1: empty response from model");

  return JSON.parse(raw) as UnderstandingOutput;
}
