import "server-only";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import type { UnderstandingOutput } from "./agent-understanding";
import type { CostTracker } from "./cost-tracker";

/** A single scene beat in the reel script. */
export type SceneBeat = {
  index: number;
  mediaPath: string;
  mediaType: "image" | "video";
  durationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
  focusX: number;
  focusY: number;
  kenBurns?: {
    direction: "in" | "out" | "left" | "right";
    intensity: "subtle" | "moderate" | "dramatic";
  };
  textOverlay?: {
    text: string;
    position: "top" | "center" | "bottom";
    style: "bold" | "handwritten" | "minimal";
  };
  transition: "fade" | "wipe" | "slide" | "cut" | "whippan" | "dissolve";
};

/** Full reel script — drives the composition generator and Remotion render. */
export type ReelScript = {
  variationIndex: number;
  direction: string;
  visualRegister: string;
  theme: string;
  colorPalette: string[];
  durationSec: number;
  musicMood: string[];
  musicTempo: "slow" | "moderate" | "fast";
  scenes: SceneBeat[];
  titleCard: {
    headline: string;
    subtitle: string;
    durationSec: number;
  };
  closingCard: {
    text: string;
    callToAction: string;
    durationSec: number;
  };
  brandingConfig: {
    logoPlacement: string;
    schoolName: string;
  };
  animationStyle: string;
  typography: {
    heading: string;
    body: string;
    accent?: string;
  };
};

/** Agent 2 (reel) output — stored in ai_generation_jobs.agent2_output. */
export type ReelCreativeOutput = {
  variations: ReelScript[];
};

type BrandAsset = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
};

type ReelAgent2Input = {
  understanding: UnderstandingOutput;
  brandAssets: BrandAsset[];
  requestedDurationSec: number;
  schoolName: string;
  schoolGuidelines?: string | null;
};

const SYSTEM_PROMPT = `You are an expert creative director specializing in short-form vertical video (Instagram Reels) for school marketing.

You will receive:
- An analysis of the request theme, curated images/videos, and audience (from a prior agent).
- School brand assets (logo, header, footer images).
- A requested duration (the teacher's preference — you may cap this based on available content).

Your job is to produce 3 different creative direction "reel scripts" — each is a detailed blueprint for an AI to write a Remotion (React) composition that renders a vertical 9:16 MP4 video.

CREATIVE PROCESS:
1. Analyze the uploaded media: how many photos vs videos, their content, quality, and emotional register.
2. Calculate the MAXIMUM sensible duration:
   - Each image gets 3-5 seconds of screen time (with Ken Burns zoom/pan).
   - Each video clip contributes its natural duration (trimmed to best segment, 3-8s typically).
   - Add 4s for title card + 4s for closing card.
   - Total should not exceed 180 seconds regardless of teacher's request.
   - If the calculated max is less than the teacher's request, use the calculated max.
3. Design 3 DIFFERENT visual registers for the reel. Think about:
   - Scrapbook/notebook: warm, handwritten feel, photos as polaroids
   - Kinetic typography: bold word stamps synced to beats, high energy
   - iPhone POV: handheld camera simulation, notification cards as captions
   - College bulletin: clean cards, navy/gold, formal event recap
   - Slow cinema: letterboxed, architectural, ambient drone
   - Collage/magazine: layered photos, overlapping frames, editorial
   - Neon/modern: dark backgrounds, glowing text, contemporary feel
   These are EXAMPLES — you can invent entirely new visual registers.
4. For each variation, sequence the scenes chronologically or thematically.
5. Assign transitions that match the mood:
   - "fade" for contemplative, slow content
   - "cut" for high-energy, fast-paced
   - "whippan" for dynamic camera movement feel
   - "dissolve" for dreamy, soft transitions
   - "slide" for structured, editorial feel
6. Choose music mood keywords for Pixabay search.
7. Pick typography (Google Fonts) that matches the register.

DURATION RULES:
- Title card: 3-5 seconds
- Each scene: 3-6 seconds (images shorter, videos can be longer)
- Closing card: 3-5 seconds
- Total duration = title + sum(scenes) + closing + transition overlaps
- NEVER exceed 180 seconds total

MEDIA ASSIGNMENT RULES:
- Every curated image/video MUST appear in exactly ONE scene
- Do NOT duplicate media across scenes
- Trim videos to their most compelling 3-8 second segment
- For images, specify Ken Burns direction (zoom in, pan left, etc.)
- focusX/focusY are 0-100 percentage values for the focal point

MUSIC MOOD:
- Provide 2-4 keywords for Pixabay music search (e.g., ["upbeat", "acoustic", "school"])
- Specify tempo: "slow" for reflective, "moderate" for balanced, "fast" for energetic
- The music will be trimmed to match the reel duration automatically

TYPOGRAPHY:
- Use Google Fonts only (they're available via @remotion/google-fonts)
- Good choices: Poppins, Inter, Caveat (handwriting), Playfair Display (serif), JetBrains Mono (code), Cormorant Garamond (elegant)
- Specify heading + body fonts, optionally an accent font

Return ONLY valid JSON matching this schema:
{
  "variations": [{
    "variationIndex": 1,
    "direction": "name of the creative approach",
    "visualRegister": "detailed 100-word description of the visual style, mood, and design language — this will guide the AI that writes the actual React code",
    "theme": "string",
    "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
    "durationSec": number,
    "musicMood": ["keyword1", "keyword2"],
    "musicTempo": "slow|moderate|fast",
    "scenes": [{
      "index": 1,
      "mediaPath": "exact path from curated images list",
      "mediaType": "image|video",
      "durationSec": number,
      "trimStartSec": number (for videos),
      "trimEndSec": number (for videos),
      "focusX": 50, "focusY": 50,
      "kenBurns": { "direction": "in|out|left|right", "intensity": "subtle|moderate|dramatic" },
      "textOverlay": { "text": "optional caption", "position": "top|center|bottom", "style": "bold|handwritten|minimal" },
      "transition": "fade|cut|whippan|slide|dissolve"
    }],
    "titleCard": { "headline": "short punchy title", "subtitle": "one-line subtitle", "durationSec": 4 },
    "closingCard": { "text": "closing message", "callToAction": "short CTA", "durationSec": 4 },
    "brandingConfig": { "logoPlacement": "describe where logo appears", "schoolName": "exact school name" },
    "animationStyle": "describe the animation approach — e.g., 'spring physics with gentle wobble' or 'hard cuts, scale punches on beat'",
    "typography": { "heading": "Google Font name", "body": "Google Font name", "accent": "optional Google Font name" }
  }]
}`;

export async function runReelCreativeAgent(
  input: ReelAgent2Input,
  costTracker?: CostTracker,
): Promise<ReelCreativeOutput> {
  const openai = await getModelClient();

  const curatedSummary = input.understanding.curatedImages
    .map(
      (img) =>
        `- ${img.path} [relevance: ${img.relevanceScore}, quality: ${img.quality}]: ${img.description}`,
    )
    .join("\n");

  const brandSummary = input.brandAssets
    .map(
      (a) =>
        `- ${a.assetType}${a.label ? ` (${a.label})` : ""}: ${a.storagePath}`,
    )
    .join("\n");

  // Determine media types from file extensions
  const imageCount = input.understanding.curatedImages.filter(
    (img) => /\.(jpg|jpeg|png|webp|gif)$/i.test(img.path),
  ).length;
  const videoCount = input.understanding.curatedImages.filter(
    (img) => /\.(mp4|mov|webm|avi)$/i.test(img.path),
  ).length;

  const userMessage = `## School: ${input.schoolName}
## Requested duration: ${input.requestedDurationSec} seconds
## Media: ${imageCount} images, ${videoCount} videos (${input.understanding.curatedImages.length} total curated)

## Theme Analysis (from prior agent)
- Theme: ${input.understanding.theme}
- Core message: ${input.understanding.coreMessage}
- Audience: ${input.understanding.audience}
- Tone: ${input.understanding.tone}
- Constraints: ${input.understanding.constraints.join("; ") || "none"}

## Curated Media
${curatedSummary || "(No media uploaded)"}

## School Brand Assets
${brandSummary || "(No brand assets configured)"}

${input.schoolGuidelines ? `## SCHOOL-SPECIFIC GUIDELINES (MUST FOLLOW)\n${input.schoolGuidelines}` : ""}

Create 3 different reel script variations. Each should use a DISTINCT visual register and creative approach.`;

  // Attach brand asset images for vision analysis
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [{ type: "text", text: userMessage }];

  const brandWithUrls = input.brandAssets.filter((a) => !!a.signedUrl && a.assetType !== "sample");
  for (const asset of brandWithUrls) {
    userContent.push({
      type: "text",
      text: `[Brand asset: ${asset.assetType}${asset.label ? ` — ${asset.label}` : ""}]`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: asset.signedUrl, detail: "low" },
    });
  }

  console.log(
    `[ReelAgent2] ${input.understanding.curatedImages.length} curated media, ${brandWithUrls.length} brand assets, requested ${input.requestedDurationSec}s`,
  );

  const response = await withRateLimitRetry(() =>
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      max_tokens: 12000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  );

  const content = response.choices[0]?.message?.content ?? "{}";
  costTracker?.addLLMCall(
    "reel-agent-2-creative",
    "gpt-4o-mini",
    response.usage as Record<string, number> | undefined,
  );

  const parsed = JSON.parse(content) as ReelCreativeOutput;

  // Log summary
  for (const v of parsed.variations) {
    console.log(
      `[ReelAgent2] V${v.variationIndex}: "${v.direction}" — ${v.scenes.length} scenes, ${v.durationSec}s, music: [${v.musicMood.join(", ")}] ${v.musicTempo}`,
    );
  }

  return parsed;
}
