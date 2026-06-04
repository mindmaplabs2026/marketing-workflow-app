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

Your job:
1. Decide 3 DISTINCT creative directions. Each must feel genuinely different — different visual mood, different layout approach, different use of imagery. Do NOT produce variations that are only slightly different. Example directions might be: one photographic/collage-focused, one typographic/minimal, one illustrative/conceptual. The categories are NOT fixed — choose what fits the theme.

2. For each direction, research mentally what current design trends apply (color palettes, typography styles, layout patterns trending on Instagram for this kind of content).

3. For each direction, produce a detailed creative brief including:
   - Theme and specific color palette (hex codes)
   - Text content: headline, subheadline, body text, call to action
   - Which curated images to use (reference by exact path), where to place them
   - Logo, header, footer placement and style adaptation (NEVER just stamp — adapt creatively each time)
   - Whether to use uniform and/or infrastructure images, and HOW
   - A detailed designPrompt that could be sent directly to an image generation model

RULES for school assets:
- Logo MUST appear in every poster, but placement and style adaptation should be unique per variation.
- Header and footer should be adapted to match each variation's theme, not copy-pasted.
- Uniform: MANDATORY when AI-generated students appear. NEVER modify uploaded real student photos.
- Infrastructure images: use ONLY when they enhance the design. Not every poster needs them.
- For one of the three variations, incorporate more school-specific assets (uniform, infrastructure). The other two can be more creative/abstract.

RULES for carousel:
- All pages must share a cohesive visual theme (consistent palette, typography, style).
- First page = attention-grabbing cover. Last page = call to action.
- Maximum 4-5 images per page in collage layout.

Return ONLY valid JSON matching this schema:
{
  "variations": [{
    "variationIndex": 1,
    "direction": "string",
    "theme": "string",
    "colorPalette": ["#hex1", "#hex2", ...],
    "textContent": { "headline": "", "subheadline": "", "bodyText": "", "callToAction": "" },
    "selectedImages": [{ "path": "string", "placement": "string" }],
    "layout": { "type": "single|carousel", "pages": [{ "pageIndex": 1, "description": "...", "selectedImages": [...], "textOverlays": [...] }] },
    "logoPlacement": { "position": "string", "size": "string", "style": "string" },
    "headerFooter": { "headerStyle": "string", "footerStyle": "string" },
    "schoolAssetUsage": { "useUniform": true/false, "uniformNotes": "...", "useInfrastructure": true/false, "infrastructureNotes": "..." },
    "designPrompt": "string — detailed prompt for image generation model"
  }, ... (3 total)]
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

Create 3 distinct creative direction briefs.`;

  // Include curated image thumbnails so the model can see them
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [{ type: "text", text: userMessage }];

  // Attach brand asset images
  for (const asset of input.brandAssets) {
    if (asset.signedUrl) {
      userContent.push({
        type: "image_url",
        image_url: { url: asset.signedUrl, detail: "low" },
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
