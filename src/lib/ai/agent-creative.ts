import "server-only";
import { getOpenAI } from "./openai-client";
import type { UnderstandingOutput } from "./agent-understanding";

/** Layout for a single poster page. */
export type PageLayout = {
  pageIndex: number;
  description: string;
  selectedImages: { path: string; placement: string; size: string }[];
  textOverlays: { text: string; position: string; style: string }[];
};

/** One creative variation brief — drives Agent 3. */
export type VariationBrief = {
  variationIndex: number;
  direction: string;
  theme: string;
  colorPalette: string[];
  textContent: {
    headline: string;
    subheadline: string;
    bodyText: string;
    callToAction: string;
  };
  selectedImages: { path: string; placement: string }[];
  layout: {
    type: "single" | "carousel";
    pages: PageLayout[];
  };
  logoPlacement: { position: string; size: string; style: string };
  headerFooter: { headerStyle: string; footerStyle: string };
  schoolAssetUsage: {
    useUniform: boolean;
    uniformNotes: string;
    useInfrastructure: boolean;
    infrastructureNotes: string;
  };
  designPrompt: string;
};

/** Agent 2 output — stored in ai_generation_jobs.agent2_output. */
export type CreativeOutput = {
  variations: [VariationBrief, VariationBrief, VariationBrief];
};

type BrandAsset = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
};

type Agent2Input = {
  understanding: UnderstandingOutput;
  brandAssets: BrandAsset[];
  posterType: "single" | "carousel";
  schoolName: string;
};

const SYSTEM_PROMPT = `You are an expert creative director specializing in school marketing posters for Instagram.

You will receive:
- An analysis of the request theme, curated images, and audience (from a prior agent).
- School brand assets (logo, header, footer, uniform, infrastructure images).
- Whether this is a single poster or carousel (3-5 pages).

Your job is to produce ONE strong creative brief for an Instagram poster.

DESIGN PROCESS:
1. Pick a creative direction that best fits the theme and audience. Consider these approaches:
   - Photographic/collage: if strong uploaded photos are available, build the design around them
   - Typographic/minimal: if the message is powerful, let bold typography lead with minimal imagery
   - Illustrative/conceptual: if it's an event without photos, create a visual concept
   Choose whichever works best — do NOT default to the same approach every time.

2. Apply current Instagram design best practices:
   - Clean, uncluttered layouts with generous breathing room
   - Bold, modern sans-serif typography (one headline, one short tagline MAX)
   - Vibrant but cohesive color palettes (3-5 colors, include hex codes)
   - Strong visual hierarchy: one focal point, clear reading order
   - Portrait orientation (4:5 ratio, 1080x1350px)
   - Premium, polished look — think magazine ad, not school flyer

3. Produce a detailed creative brief covering every element:
   - Theme and specific color palette (hex codes)
   - Text content: headline + subheadline ONLY (keep text minimal — posters are visual, not text documents)
   - Which curated images to use (reference by exact filename/path), and where to place them
   - Logo, header, footer placement and style adaptation
   - Whether to use uniform and/or infrastructure images, and HOW
   - A detailed designPrompt describing the final poster for the image generation model

RULES for uploaded photos:
- If photos are provided, they are the HERO of the poster. Build the design AROUND them.
- NEVER transform, edit, redraw, or replace uploaded photos. Use them exactly as-is.
- Do NOT add uniforms or modifications to people in uploaded photos.

RULES for event-based posters (no uploaded photos):
- Generate all imagery from scratch to match the theme.
- When AI-generated students appear, they MUST wear the school uniform (reference image provided).
- Infrastructure images can be used as setting/background reference.

RULES for school brand assets:
- Logo MUST appear in every poster. Adapt its placement creatively — do NOT just stamp it.
- Header MUST appear at the top of every page. Adapt style to match the theme.
- Footer MUST appear at the bottom of every page. Adapt style to match the theme.

RULES for carousel:
- All pages share a cohesive visual theme (consistent palette, typography, style).
- Page 1 = attention-grabbing cover. Last page = call to action.
- Maximum 4-5 images per page in collage layout.

TEXT RULES:
- HEADLINE: short, punchy, max 6-8 words
- SUBHEADLINE: one short line, max 10-12 words
- Do NOT include body text or long descriptions ON the poster — that goes in the Instagram caption, not the image
- Call to action: optional, very short (e.g., "Join us!", "Learn more")

Return ONLY valid JSON matching this schema:
{
  "variations": [{
    "variationIndex": 1,
    "direction": "string — name of the creative approach",
    "theme": "string",
    "colorPalette": ["#hex1", "#hex2", ...],
    "textContent": { "headline": "short punchy headline", "subheadline": "one short tagline", "bodyText": "", "callToAction": "" },
    "selectedImages": [{ "path": "exact filename from curated list", "placement": "description of placement" }],
    "layout": { "type": "single|carousel", "pages": [{ "pageIndex": 1, "description": "visual description of this page", "selectedImages": [...], "textOverlays": [{ "text": "...", "position": "...", "style": "..." }] }] },
    "logoPlacement": { "position": "string", "size": "string", "style": "string" },
    "headerFooter": { "headerStyle": "string", "footerStyle": "string" },
    "schoolAssetUsage": { "useUniform": true/false, "uniformNotes": "...", "useInfrastructure": true/false, "infrastructureNotes": "..." },
    "designPrompt": "string — highly detailed prompt describing the exact final poster visual for the image generation model"
  }]
}`;

export async function runCreativeAgent(
  input: Agent2Input,
): Promise<CreativeOutput> {
  const openai = getOpenAI();

  const brandAssetSummary = input.brandAssets
    .map(
      (a) =>
        `- ${a.assetType}${a.label ? ` (${a.label})` : ""}: ${a.storagePath}`,
    )
    .join("\n");

  const curatedImagesSummary = input.understanding.curatedImages
    .map(
      (img) =>
        `- ${img.path} [relevance: ${img.relevanceScore}, quality: ${img.quality}]: ${img.description}`,
    )
    .join("\n");

  const userMessage = `## School: ${input.schoolName}
## Poster type: ${input.posterType}${input.posterType === "carousel" ? " (3-5 pages)" : ""}

## Theme Analysis (from prior agent)
- Theme: ${input.understanding.theme}
- Core message: ${input.understanding.coreMessage}
- Audience: ${input.understanding.audience}
- Tone: ${input.understanding.tone}
- Constraints: ${input.understanding.constraints.join("; ") || "none"}

## Curated Images
${curatedImagesSummary || "(No images uploaded — event-based poster, generate all visuals)"}

## School Brand Assets
${brandAssetSummary || "(No brand assets configured yet)"}

Create 1 creative direction brief. Make it the strongest possible direction for this theme.`;

  // Include curated image thumbnails so the model can see them
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = [{ type: "text", text: userMessage }];

  // Attach brand asset images
  for (const asset of input.brandAssets) {
    if (asset.signedUrl) {
      userContent.push({
        type: "image_url",
        image_url: { url: asset.signedUrl, detail: "high" },
      });
      userContent.push({
        type: "text",
        text: `[Brand asset: ${asset.assetType} — ${asset.storagePath}]`,
      });
    }
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8192,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Agent 2: empty response from model");

  return JSON.parse(raw) as CreativeOutput;
}
