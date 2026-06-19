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
  /** Video scene whose clip contains spoken words → play the clip's own audio and
   *  duck the background music during this scene. Carried from the curated entry. */
  containsSpeech?: boolean;
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
  /** Actual curated media (image URL / a video keyframe) so the director can SEE
   *  the footage and choose a palette/mood that complements it — not direct blind. */
  curatedMedia?: { path: string; url: string; mediaType: "image" | "video"; description: string }[];
  /** Brand anchor colors extracted from the school logo, to keep palettes on-brand. */
  brandColors?: string[];
  /** Measured logo tone/transparency, so logoPlacement specifies a contrasting backing. */
  logoProfile?: { tone: string; hasTransparency: boolean; requiredBackground: "light" | "dark" | "any" };
};

const SYSTEM_PROMPT = `You are an expert creative director specializing in short-form vertical video (Instagram Reels) for school marketing.

You are a CREATIVE DIRECTOR, not just a scriptwriter. The colour palette, typography,
and visual register you choose are BINDING — a downstream agent writes the actual
React/Remotion code to YOUR spec. Direct from what you SEE, not from a synopsis.

You will receive:
- An analysis of the request theme, curated images/videos, and audience (from a prior agent).
- The ACTUAL curated photos and a keyframe from each video (attached as images) — LOOK at them:
  their real colours, lighting, and mood must drive your palette and register choices, so the
  design complements the footage instead of fighting it.
- School brand assets (logo, header, footer images) and the school's BRAND COLOURS.
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
3. Design 3 DIFFERENT visual registers for the reel.
   You MUST pick 3 DIFFERENT styles from this list. Do NOT pick the same style twice.
   Do NOT default to scrapbook/polaroid — that style is overused. Pick others.

   FRAMED styles (photo sits inside a frame with breathing room):
   A. Magazine editorial: photos in rounded white cards, serif typography, glossy yearbook feel
   B. Film strip: photos inside sprocket-hole film frames, dark background, retro cinema
   C. Postcard stack: photos as postcards dropped onto a wooden table, stamps and handwritten notes
   D. Minimal floating card: single photo in a shadowed card, dark background, huge negative space
   E. Split screen: clean geometric frames (2-up or 3-up grids), modern sans-serif
   F. Scrapbook/notebook: warm, handwritten feel, photos as polaroids taped on a notebook page
   G. College bulletin: clean cards, navy/gold header band, formal event recap

   FULL-BLEED styles (photo fills the entire screen):
   H. Bold overlay: full-bleed photo/video with large text overlaid, gradient darken at bottom
   I. Cinematic letterbox: full-bleed with black bars top/bottom (21:9 feel), minimal text
   J. Story slides: full-bleed with Instagram-story-style text stickers, emoji, color blocks
   K. Kinetic typography: bold word stamps synced to beats, high energy, hard cuts
   L. iPhone POV: handheld camera simulation, notification cards as captions

   IMPORTANT: When using full-bleed styles, ALWAYS set objectPosition using the focusX/focusY
   values from the curated list so the subject stays centered even when cropped to 9:16.
   When using framed styles (cards, strips, grids), this is less critical since the frame
   preserves the photo's natural composition.

   VARIETY RULES (MANDATORY):
   - Your 3 variations MUST use 3 DIFFERENT letter codes from the list above (e.g., A, H, D — not A, A, F)
   - At least 1 variation MUST be a framed style (A-G)
   - At least 1 variation MUST be a full-bleed style (H-L)
   - The 3rd variation can be either — but it MUST be different from the other two
   - Each variation should feel DISTINCTLY different in look and mood
   - State which letter code you chose in the "direction" field (e.g., "B — Film Strip Chronicle")
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
- Each scene: 3-8 seconds (images 3-5s, videos 4-8s using their natural duration)
- Closing card: 3-5 seconds
- Total duration = title + sum(scenes) + closing
- Your goal is to fill the REQUESTED duration as closely as possible.
  If the teacher requested 120s, try to produce a reel close to 120s.
  Use ALL curated media to fill the time. Give each scene enough breathing room.
- If you have more content than fits in the requested duration, prioritize
  videos and the highest-relevance images.
- NEVER exceed 300 seconds (5 minutes) total regardless of requested duration.

MEDIA ASSIGNMENT RULES:
- The curated list is a list of ENTRIES. Each entry becomes exactly ONE scene.
- A long video may appear as SEVERAL entries, each with a DIFFERENT suggested trim
  window (e.g. the same .mp4 at 0-8s, then 40-48s, then 95-103s). This is intentional:
  treat each entry as its own distinct scene using ITS OWN trim window. Do NOT collapse
  them into one scene, and do NOT reuse the same trim window twice.
- Do NOT reuse the SAME still IMAGE in more than one scene.
- MANDATORY VIDEO USAGE: If the curated list contains videos, you MUST use ALL of them
  (every entry, including the multiple trim windows of a long video).
  Videos are MORE valuable than images for reels — they show movement, action, and life.
  A reel with only still images feels like a slideshow. Videos make it feel alive.
  Aim for at least 40-60% of scenes to be video clips when videos are available.
  NEVER skip a curated video in favor of an image.
- Set mediaType to "image" or "video" for each scene EXACTLY matching the curated media list.
  If the curated list says the item is a video (mediaType: "video"), your scene MUST have mediaType: "video".
  If it's an image (mediaType: "image"), your scene MUST have mediaType: "image".
  NEVER set mediaType: "image" for a file that is listed as a video in the curated list.
- For VIDEOS: use the suggested trim points from the curated list (suggestedTrimStart/suggestedTrimEnd).
  If no suggestion, pick the most compelling 3-8 second segment. Set trimStartSec and trimEndSec.
  Videos should use their natural duration within the trim window (don't force them to 3s if they have 6s of good content).
- For IMAGES: specify Ken Burns direction (zoom in, pan left, etc.). Images typically get 3-5s per scene.
- focusX/focusY are 0-100 percentage values for the focal point

TEXT OVERLAY PLACEMENT (CRITICAL — avoid covering faces and subjects):
- The textOverlay position MUST be chosen based on focusY (where the subject is):
  - If focusY <= 40 (subject is in the TOP of the image) → position: "bottom"
  - If focusY >= 60 (subject is in the BOTTOM of the image) → position: "top"
  - If focusY is 40-60 (subject is centered) → position: "top" or "bottom", NOT "center"
- NEVER place text at "center" when the photo has people — it WILL cover faces
- For full-bleed styles: text always goes in the opposite third from the focal point
- For framed styles: text goes OUTSIDE the frame (below or above the card), not overlaid
- Keep text overlays SHORT (3-6 words max) — long text blocks cover more of the image

VERIFY YOUR WORK:
1. Count the curated video ENTRIES (a long video split into N trim windows counts as N).
   Count the video scenes you created. They MUST match — one scene per entry.
2. Every scene with a .mp4 or .mov file MUST have mediaType: "video", trimStartSec, and trimEndSec.
3. If a video has 3 curated trim windows, your scenes MUST include 3 separate scenes for it,
   each using its own window — never just one.

AUDIO MIX (speech vs background music):
- Each curated video entry is tagged SPEECH when someone is talking in it (interview,
  statement, dialogue). Copy that onto the scene as "containsSpeech": true.
- The composition will, for speech scenes, play the CLIP'S OWN audio (the speaker's
  voice) and DUCK the background music low so the voice is clearly audible.
- If the reel is SPEECH-HEAVY (most video scenes are speech — an interview/statement
  reel), pick a calmer musicMood and "slow"/"moderate" tempo so the BGM sits under the
  voices; do NOT pick loud/"fast" tracks that fight the talking.

MUSIC MOOD:
- Provide 2-4 keywords for Pixabay music search (e.g., ["upbeat", "acoustic", "school"])
- Specify tempo: "slow" for reflective, "moderate" for balanced, "fast" for energetic
- The music will be trimmed to match the reel duration automatically

COLOR PALETTE (direct from the footage + brand):
- Build each variation's 4-6 colour palette from what you SEE in the attached curated media
  (dominant tones, lighting, mood) so the design complements the photos/videos.
- Anchor the palette to the school's BRAND COLOURS when provided: include at least one brand
  colour (or a close, tasteful variant) so the reel stays on-brand. Do not ignore them.
- The 3 variations MUST have DISTINCT palettes (different mood/temperature), not three
  near-identical colour sets. Provide real hex values.

TYPOGRAPHY:
- Use Google Fonts only (they're available via @remotion/google-fonts)
- Good choices: Poppins, Inter, Caveat (handwriting), Playfair Display (serif), JetBrains Mono (code), Cormorant Garamond (elegant)
- Specify heading + body fonts, optionally an accent font
- The 3 variations should use DISTINCT typography (don't reuse the same font pairing for all three)

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
      "containsSpeech": true_or_false (copy from the curated video entry),
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
    .map((img) => {
      let line = `- ${img.path} [${img.mediaType ?? "image"}, relevance: ${img.relevanceScore}, quality: ${img.quality}]: ${img.description}`;
      if (img.mediaType === "video") {
        line += ` (VIDEO: ${img.durationSec ?? "?"}s`;
        if (img.suggestedTrimStart != null && img.suggestedTrimEnd != null) {
          line += `, suggested trim: ${img.suggestedTrimStart}s-${img.suggestedTrimEnd}s`;
        }
        if (img.containsSpeech) line += `, SPEECH`;
        line += ")";
      }
      return line;
    })
    .join("\n");

  const brandSummary = input.brandAssets
    .map(
      (a) =>
        `- ${a.assetType}${a.label ? ` (${a.label})` : ""}: ${a.storagePath}`,
    )
    .join("\n");

  // Count by mediaType (set by Agent 1) with fallback to file extension
  const imageCount = input.understanding.curatedImages.filter(
    (img) => img.mediaType === "image" || (!img.mediaType && /\.(jpg|jpeg|png|webp|gif)$/i.test(img.path)),
  ).length;
  const videoCount = input.understanding.curatedImages.filter(
    (img) => img.mediaType === "video" || (!img.mediaType && /\.(mp4|mov|webm|avi)$/i.test(img.path)),
  ).length;

  const brandColorsLine = input.brandColors?.length
    ? `## Brand colours (anchor palettes to these): ${input.brandColors.join(", ")}`
    : "";
  const logoBgLine = input.logoProfile && input.logoProfile.requiredBackground !== "any"
    ? `## Logo: it is ${input.logoProfile.tone}${input.logoProfile.hasTransparency ? " with transparency" : ""} — in logoPlacement, specify it sits on a ${input.logoProfile.requiredBackground === "light" ? "LIGHT/WHITE" : "DARK"} backing/chip (otherwise it is invisible).`
    : "";

  const userMessage = `## School: ${input.schoolName}
## Requested duration: ${input.requestedDurationSec} seconds
## Media: ${imageCount} images, ${videoCount} videos (${input.understanding.curatedImages.length} total curated)
${brandColorsLine}
${logoBgLine}

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

  // Attach the ACTUAL curated media so the director chooses palette/mood from the
  // real footage. Low detail keeps cost down — enough to read colour and mood.
  const curatedMedia = input.curatedMedia ?? [];
  if (curatedMedia.length) {
    userContent.push({
      type: "text",
      text: `\n[CURATED MEDIA BELOW — look at these to choose palettes/registers that complement the real footage]`,
    });
    for (const m of curatedMedia) {
      userContent.push({
        type: "text",
        text: `[${m.mediaType}: ${m.path.split("/").pop()}${m.mediaType === "video" ? " (keyframe)" : ""}]`,
      });
      userContent.push({
        type: "image_url",
        image_url: { url: m.url, detail: "low" },
      });
    }
  }

  console.log(
    `[ReelAgent2] ${input.understanding.curatedImages.length} curated media, ${curatedMedia.length} shown to director, ${brandWithUrls.length} brand assets, brand colours [${(input.brandColors ?? []).join(", ") || "none"}], requested ${input.requestedDurationSec}s`,
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

  // Log summary with video breakdown
  for (const v of parsed.variations) {
    const videoScenes = v.scenes.filter((s) => s.mediaType === "video");
    const imageScenes = v.scenes.filter((s) => s.mediaType === "image");
    console.log(
      `[ReelAgent2] V${v.variationIndex}: "${v.direction}" — ${v.scenes.length} scenes (${videoScenes.length} video, ${imageScenes.length} image), ${v.durationSec}s, music: [${v.musicMood.join(", ")}] ${v.musicTempo}`,
    );
    for (const vs of videoScenes) {
      console.log(
        `[ReelAgent2]   VIDEO scene ${vs.index}: ${vs.mediaPath.split("/").pop()} (${vs.durationSec}s, trim ${vs.trimStartSec ?? "?"}s-${vs.trimEndSec ?? "?"}s)`,
      );
    }
    // Warn if no videos despite curated videos being available
    if (videoScenes.length === 0 && videoCount > 0) {
      console.warn(`[ReelAgent2] WARNING: V${v.variationIndex} has 0 video scenes but ${videoCount} curated videos exist!`);
    }
  }

  return parsed;
}
