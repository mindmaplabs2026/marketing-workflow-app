import "server-only";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import type { UnderstandingOutput } from "./agent-understanding";
import type { CostTracker } from "./cost-tracker";

/** Layout for a single poster page. */
export type PageLayout = {
  pageIndex: number;
  description: string;
  selectedImages: { path: string; placement: string; size: string }[];
  textOverlays: { text: string; position: string; style: string }[];
  /** Per-page creative vision — used for carousel pages. */
  creativeVision?: string;
  /** Per-page design prompt — used for carousel pages. */
  designPrompt?: string;
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
PAGE COUNT:
- Carousel page count depends on how many curated images are available:
  - Fewer than 15 curated images → 3 pages (cover + 1 middle photo page + closing)
  - 15+ curated images → 4 or 5 pages (cover + 2-3 middle photo pages + closing)
  - 0 photos (event-based) → 3 pages

TYPOGRAPHY (CRITICAL — must be identical across ALL pages):
- Choose ONE specific font family for all pages (e.g., "Montserrat Bold for headlines, Montserrat Medium for body"). State the exact font in the top-level creativeVision.
- Headline font size, weight, and color MUST be the same on every page.
- Body/subtext font size, weight, and color MUST be the same on every page.
- Text position rules (e.g., "headline always in upper 20% area") should be consistent.
- Do NOT vary fonts, sizes, or text styling between pages.

VISUAL CONSISTENCY (CRITICAL — every page must feel like part of the same set):
- Same background color/gradient/texture on ALL pages.
- Same border/frame treatment on ALL pages.
- Same header/footer appearance on ALL pages.
- Same decorative elements style on ALL pages (icons, patterns, leaf motifs, etc.).
- A viewer swiping through must feel these pages belong together as a unified series.

PAGE STRUCTURE AND PHOTO DISTRIBUTION:
Follow this process step by step:
1. Count the total curated images available (listed in "Curated Images" above).
2. Reserve 0-1 for the cover page (pick the best group/hero shot, or use 0 for a typography-first cover).
3. Reserve 0-1 for the closing page.
4. The REMAINING photos ALL go to the middle pages. Divide them evenly.
   Example: 10 curated images → 1 cover + 0 closing = 9 for middle. With 1 middle page → 9 photos (cap at 6, so use 6). With 2 middle pages → 4 and 5. With 3 middle pages → 3, 3, 3.
5. Each middle page MUST have 3-6 photos. If the math gives fewer than 3, combine middle pages. If more than 6, add another middle page or cap at 6.

PAGE-BY-PAGE RULES:
- PAGE 1 (Cover): 0-1 photos. Strong headline, creative typography. If using a photo, pick the single best group shot.
- MIDDLE PAGES: 3-6 photos EACH in collage/grid layout. Group photos THEMATICALLY — e.g., outdoor activities together, classroom moments together, performances together. Use layouts like 2x2 grid, 2x3 grid, 3-column strips, staggered overlapping. The "selectedImages" array for each middle page MUST contain 3-6 entries. State the exact count in the page's "designPrompt" field.
- LAST PAGE (Closing): 0-1 photos. School contact details, tagline, CTA text. Wrap-up page.

CRITICAL PATH FORMAT: Each selectedImages entry MUST have a "path" field containing the EXACT full path string from the "Curated Images" list above. Copy-paste the path — do NOT abbreviate, truncate, or use just the filename. Example: if the curated list shows "school-id/request-id/IMG_4521.jpg", use exactly "school-id/request-id/IMG_4521.jpg" as the path.

VERIFY YOUR WORK: Before outputting:
1. Count photos in each page's selectedImages array. Cover ≤1, each middle page 3-6, closing ≤1.
2. Check every selectedImages entry has a valid "path" field — not null, not undefined, not empty.
3. Check paths match exactly with the curated images list.
If any middle page has fewer than 3, add more from the curated list.

IMPORTANT: Each carousel page is generated by a SEPARATE AI image model call, so each page MUST be self-contained:
  - Each page object MUST have its own "creativeVision" field (50-100 words) — a rich visual description of THAT specific page's layout, hero content, text placement, and mood. Include the exact font family and size for that page's text.
  - Each page object MUST have its own "designPrompt" field — a concise technical prompt for THAT page's image generation.
  - The top-level "creativeVision" field should ONLY contain the shared visual consistency rules (typography with exact font names, colors, borders, background pattern, header/footer style) that apply to ALL pages.
  - The top-level "designPrompt" field should be a brief overall summary.
- Each page's selectedImages should specify which uploaded photos go on THAT page.

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
    "layout": { "type": "single|carousel", "pages": [{ "pageIndex": 1, "description": "visual description of this page", "selectedImages": [{ "path": "EXACT path from curated images list above — copy the full path string exactly as shown", "placement": "where in the layout", "size": "small|medium|large" }], "textOverlays": [{ "text": "...", "position": "...", "style": "..." }], "creativeVision": "FOR CAROUSEL ONLY — rich per-page visual narrative (50-100 words) describing this specific page's layout, hero content, composition, and mood", "designPrompt": "FOR CAROUSEL ONLY — concise per-page technical prompt for the image model" }] },
    "logoPlacement": { "position": "string", "size": "string", "style": "string" },
    "headerFooter": { "headerStyle": "string", "footerStyle": "string" },
    "schoolAssetUsage": { "useUniform": true/false, "uniformNotes": "...", "useInfrastructure": true/false, "infrastructureNotes": "..." },
    "creativeVision": "string — For SINGLE posters: THIS IS THE MOST IMPORTANT FIELD. Write a rich, vivid, detailed creative narrative describing the poster top-to-bottom (min 150 words). For CAROUSELS: Write ONLY the shared visual consistency rules that EVERY page must follow — exact font family and sizes (e.g., 'Montserrat Bold 48px for headlines, Montserrat Medium 18px for body text, white color on dark backgrounds'), exact background treatment, border/frame style, color application rules, header/footer appearance, decorative element style. This block is prepended to every page's prompt, so be precise and prescriptive.",
    "designPrompt": "string — concise technical prompt for the image model, derived from the creativeVision above"
  }]
}`;

export async function runCreativeAgent(
  input: Agent2Input,
  costTracker?: CostTracker,
): Promise<CreativeOutput> {
  const openai = await getModelClient();

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
## Poster type: ${input.posterType}${input.posterType === "carousel" ? ` (${input.understanding.curatedImages.length < 15 ? "3" : "4-5"} pages — ${input.understanding.curatedImages.length} curated images available)` : ""}

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
      max_output_tokens: 12000,
    }),
  );

  costTracker?.addLLMCall("agent2_creative", "gpt-4o-mini", response.usage);

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
