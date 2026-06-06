import "server-only";
import { getOpenAI, withRateLimitRetry } from "./openai-client";
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
  variations: VariationBrief[];
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
  schoolGuidelines?: string | null;
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
- LOOK at each brand asset image carefully before deciding what to use. Headers often already contain the school logo.
- If the header image ALREADY contains the logo, do NOT add a separate logo — set "logo" to null in selectedAssets to avoid redundancy (double logo).
- Only set "logo" to a storage_path if you need a STANDALONE logo placement that isn't already covered by the header.
- Header: pick ONE header for the top of every page, if available. Set to null if not needed.
- Footer: pick ONE footer for the bottom of every page, if available. Set to null if not needed.
- If uniform or infrastructure are needed, pick the most relevant one and specify its storage_path.
- Pick 2-3 sample posters that are MOST relevant to this theme as style references. Specify their exact storage_paths.
- IMPORTANT: Use the EXACT storage_path strings from the "School Brand Assets" list above. Do not modify them.

RULES for carousel:
- All pages MUST share a cohesive visual identity: same color palette, same typography style, same header/footer treatment, same background texture/pattern family. A viewer swiping through must feel these pages belong together.
- Page 1 = attention-grabbing cover with the headline. Last page = call to action.
- Maximum 4-5 images per page in collage layout.
- IMPORTANT: For carousels, the "creativeVision" field must describe EACH PAGE individually in separate paragraphs, labeled "PAGE 1:", "PAGE 2:", etc. Each page description should be 50-80 words covering layout, visual content, text placement, and mood for that specific page. Also include a brief "VISUAL CONSISTENCY" paragraph at the start describing the shared design language across all pages (typography, colors, borders, background pattern, header/footer style).
- Each page's "description" in the layout.pages array should be a detailed visual description (not just a title), and page-level selectedImages should specify which uploaded photos go on THAT page (not all photos on every page).

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
    "selectedAssets": {
      "logo": "exact storage_path of the logo to use, or null if the header already contains the logo",
      "header": "exact storage_path of the header to use, or null if not needed",
      "footer": "exact storage_path of the footer to use, or null if not needed",
      "uniform": "exact storage_path or null if not needed",
      "infrastructure": "exact storage_path or null if not needed",
      "samples": ["storage_path of 2-3 sample posters to use as style reference — pick the most relevant ones for this theme"]
    },
    "layout": { "type": "single|carousel", "pages": [{ "pageIndex": 1, "description": "visual description of this page", "selectedImages": [...], "textOverlays": [{ "text": "...", "position": "...", "style": "..." }] }] },
    "logoPlacement": { "position": "string", "size": "string", "style": "string" },
    "headerFooter": { "headerStyle": "string", "footerStyle": "string" },
    "schoolAssetUsage": { "useUniform": true/false, "uniformNotes": "...", "useInfrastructure": true/false, "infrastructureNotes": "..." },
    "creativeVision": "string — THIS IS THE MOST IMPORTANT FIELD. For SINGLE posters: Write a rich, vivid, detailed creative narrative describing the poster top-to-bottom (min 150 words). For CAROUSELS: Start with a 'VISUAL CONSISTENCY:' paragraph describing the shared design language (typography, colors, borders, background pattern, header/footer treatment). Then describe each page as 'PAGE 1:', 'PAGE 2:', etc. (50-80 words each) covering that page's specific layout, hero visual, text placement, and mood. Total min 250 words for carousels.",
    "designPrompt": "string — concise technical prompt for the image model, derived from the creativeVision above"
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

${input.schoolGuidelines ? `## SCHOOL-SPECIFIC GUIDELINES (MUST FOLLOW)\nThese are mandatory instructions from the school admin. Follow them precisely:\n${input.schoolGuidelines}` : ""}

Create 1 creative direction brief. Make it the strongest possible direction for this theme.`;

  // Separate sample posters from other brand assets
  const sampleAssets = input.brandAssets.filter((a) => a.assetType === "sample");
  const otherAssets = input.brandAssets.filter((a) => a.assetType !== "sample");

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = [{ type: "text", text: userMessage }];

  // Attach a RANDOM set of sample posters as style inspiration.
  // Randomizing ensures the creative agent gets fresh references on every
  // run, which naturally produces more variety in output.
  if (sampleAssets.length > 0) {
    // Shuffle and pick up to 10
    const shuffled = [...sampleAssets].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, 10);

    userContent.push({
      type: "text",
      text: `\n## STYLE REFERENCE — ${selected.length} Sample Posters from this school (randomly selected from ${sampleAssets.length} total)\nStudy these carefully. These are real posters previously designed for this school. Your creative brief should match this level of quality and follow a similar design language:\n- Same type of layout structure (header bar, hero section, icon grid, footer bar)\n- Similar typography treatment (mixed bold/script fonts, clear hierarchy)\n- Same level of visual richness and compositing\n- School-specific branding elements integrated naturally\n- Note the contact bar at the bottom with phone, website, address\nAnalyze each sample and extract the design patterns. Do NOT copy any specific poster — create something original that feels like it belongs in the same series.`,
    });
    for (const sample of selected) {
      if (sample.signedUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: sample.signedUrl, detail: "high" },
        });
        userContent.push({
          type: "text",
          text: `[Sample poster: ${sample.label ?? sample.storagePath}]`,
        });
      }
    }
  }

  // Attach other brand asset images (logo, header, footer, etc.)
  for (const asset of otherAssets) {
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

  // Build input for the Responses API (supports web_search tool)
  const inputItems: Array<
    | { role: "developer" | "user"; content: string | Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" }>; type: "message" }
  > = [
    {
      role: "developer",
      content: SYSTEM_PROMPT,
      type: "message",
    },
    {
      role: "user",
      content: userContent.map((item) => {
        if (item.type === "text") {
          return { type: "input_text" as const, text: item.text };
        }
        return {
          type: "input_image" as const,
          image_url: item.image_url.url,
          detail: "high" as const,
        };
      }),
      type: "message",
    },
  ];

  // Use Responses API with web_search tool so the agent can research
  // current design trends, color palettes, and visual styles on its own
  const response = await withRateLimitRetry(() =>
    openai.responses.create({
      model: "gpt-4o-mini",
      input: inputItems,
      tools: [
        {
          type: "web_search",
          search_context_size: "medium",
        },
      ],
      instructions: "After researching current design trends for the theme using web search, return ONLY valid JSON matching the schema in the system instructions. Do not include any text outside the JSON.",
      max_output_tokens: 8192,
    }),
  );

  // Extract text content from the response output
  let raw = "";
  for (const item of response.output) {
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.type === "output_text") {
          raw += part.text;
        }
      }
    }
  }

  if (!raw) throw new Error("Agent 2: empty response from model");

  // Clean up: the model might wrap JSON in markdown code fences
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

  return JSON.parse(jsonStr) as CreativeOutput;
}
