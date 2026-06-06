import "server-only";
import { getOpenAI } from "./openai-client";
import type { VariationBrief } from "./agent-creative";
import type { UnderstandingOutput } from "./agent-understanding";
import { toFile } from "openai";

type BrandAssetFile = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label?: string | null;
};

type CuratedImageFile = {
  path: string;
  signedUrl: string;
};

type Agent3Input = {
  brief: VariationBrief;
  understanding: UnderstandingOutput;
  brandAssets: BrandAssetFile[];
  curatedImages: CuratedImageFile[];
  schoolName: string;
};

export type GenerationResult = {
  imageUrls: string[];
  model: string;
  prompts: string[];
  referenceImageCount: number;
  refinementRounds: number;
};

export type EvaluationResult = {
  score: number;
  feedback: string;
  passesThreshold: boolean;
};

export const QUALITY_THRESHOLD = 7; // out of 10

/**
 * Evaluates a generated poster using GPT-4o-mini vision.
 * Returns a score (1-10) and specific feedback for improvement.
 * Exported so the pipeline can call it from a separate Inngest function.
 */
export async function evaluatePoster(
  imageBase64: string,
  brief: VariationBrief,
  schoolName: string,
): Promise<EvaluationResult> {
  const openai = getOpenAI();

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a professional graphic design quality assessor for school marketing posters on Instagram.

Score the poster from 1-10 on these criteria:
- Visual impact and professional quality (does it look like a premium marketing poster?)
- Typography: is text legible, well-sized, not too much text?
- Layout: clean composition, clear visual hierarchy, breathing room?
- Branding: does it include school logo, header, footer appropriately?
- Theme relevance: does the imagery match the intended theme?
- Instagram readiness: would this perform well as an Instagram post?

Return ONLY valid JSON:
{
  "score": 1-10,
  "feedback": "specific actionable improvements — be precise about what to change",
  "passesThreshold": true/false (true if score >= ${QUALITY_THRESHOLD})
}`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `School: ${schoolName}\nTheme: ${brief.theme}\nDirection: ${brief.direction}\nHeadline: ${brief.textContent.headline}\n\nEvaluate this poster:`,
          },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" },
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 500,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) return { score: 5, feedback: "Could not evaluate", passesThreshold: false };

  try {
    return JSON.parse(raw) as EvaluationResult;
  } catch {
    return { score: 5, feedback: "Could not parse evaluation", passesThreshold: false };
  }
}

/**
 * Downloads an image from a signed URL and returns it as a Buffer.
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Generates poster image(s) for one variation using GPT Image API.
 * Passes reference images (uploaded photos + brand assets) so the model
 * can incorporate them into the poster.
 */
export async function runGenerationAgent(
  input: Agent3Input,
): Promise<GenerationResult> {
  const openai = getOpenAI();
  const { brief } = input;

  const pages =
    brief.layout.type === "carousel" ? brief.layout.pages : [brief.layout.pages[0]];

  const imageUrls: string[] = [];
  const prompts: string[] = [];

  // Use ONLY the assets that Agent 2 (creative director) selected.
  // Agent 2 outputs selectedAssets with exact storage_paths for each role.
  // No random sampling, no "always include all" — just what was picked.

  const referenceImages: { buffer: Buffer; name: string; role: string }[] = [];
  let imageIndex = 1;

  const selectedAssets = (brief as Record<string, unknown>).selectedAssets as {
    logo?: string | null;
    header?: string | null;
    footer?: string | null;
    uniform?: string | null;
    infrastructure?: string | null;
    samples?: string[];
  } | undefined;

  // Helper: find a brand asset by storage_path and download it
  async function addAsset(storagePath: string | null | undefined, role: string, assetType: string): Promise<void> {
    if (!storagePath) return;
    const asset = input.brandAssets.find((a) =>
      a.storagePath === storagePath || a.storagePath.endsWith(storagePath) || storagePath.endsWith(a.storagePath.split("/").pop() ?? "")
    );
    if (!asset?.signedUrl) return;
    const buf = await downloadImage(asset.signedUrl);
    if (!buf) return;
    const label = asset.label ?? asset.storagePath.split("/").pop() ?? assetType;
    referenceImages.push({
      buffer: buf,
      name: `image${imageIndex}_${assetType}.png`,
      role: `IMAGE ${imageIndex}: ${role} — "${label}"`,
    });
    imageIndex++;
  }

  if (selectedAssets) {
    // Agent 2 specified exactly which assets to use
    await addAsset(selectedAssets.logo, "SCHOOL LOGO — Copy this EXACTLY. Do NOT redraw", "logo");
    await addAsset(selectedAssets.header, "SCHOOL HEADER — Copy this exactly at the top", "header");
    await addAsset(selectedAssets.footer, "SCHOOL FOOTER — Copy this exactly at the bottom", "footer");
    await addAsset(selectedAssets.uniform, "UNIFORM REFERENCE — Match this for any AI-generated students", "uniform");
    await addAsset(selectedAssets.infrastructure, "INFRASTRUCTURE REFERENCE — Use as setting/background guide", "infrastructure");

    // Sample posters picked by Agent 2 for style reference
    for (const samplePath of selectedAssets.samples ?? []) {
      await addAsset(samplePath, "STYLE REFERENCE POSTER — Match this design quality and layout", "sample");
    }
  } else {
    // Fallback: Agent 2 didn't output selectedAssets (old format).
    // Use one of each core type.
    for (const assetType of ["logo", "header", "footer"] as const) {
      const asset = input.brandAssets.find((a) => a.assetType === assetType);
      if (asset) await addAsset(asset.storagePath, `SCHOOL ${assetType.toUpperCase()}`, assetType);
    }
    if (brief.schoolAssetUsage.useUniform) {
      const asset = input.brandAssets.find((a) => a.assetType === "uniform");
      if (asset) await addAsset(asset.storagePath, "UNIFORM REFERENCE", "uniform");
    }
    if (brief.schoolAssetUsage.useInfrastructure) {
      const asset = input.brandAssets.find((a) => a.assetType === "infrastructure");
      if (asset) await addAsset(asset.storagePath, "INFRASTRUCTURE REFERENCE", "infrastructure");
    }
    // Pick 2 random samples as fallback
    const samples = input.brandAssets.filter((a) => a.assetType === "sample");
    for (const s of samples.sort(() => Math.random() - 0.5).slice(0, 2)) {
      await addAsset(s.storagePath, "STYLE REFERENCE POSTER", "sample");
    }
  }

  // Add uploaded photos selected by Agent 2
  const hasUploadedPhotos = input.curatedImages.length > 0 && brief.selectedImages.length > 0;
  if (hasUploadedPhotos) {
    const selectedPaths = new Set(brief.selectedImages.map((s) => s.path));
    for (const img of input.curatedImages) {
      const imgFilename = img.path.split("/").pop() ?? "";
      const isSelected = selectedPaths.has(img.path) ||
        [...selectedPaths].some((p) => img.path.endsWith(p) || p.endsWith(imgFilename));
      if (isSelected) {
        const buf = await downloadImage(img.signedUrl);
        if (buf) {
          referenceImages.push({
            buffer: buf,
            name: `image${imageIndex}_photo.png`,
            role: `IMAGE ${imageIndex}: UPLOADED PHOTO — "${imgFilename}". Include this photo AS-IS. Do NOT modify or redraw it.`,
          });
          imageIndex++;
        }
      }
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isCarousel = brief.layout.type === "carousel";
    const pageContext = isCarousel
      ? `\n\nThis is page ${i + 1} of ${pages.length} in a carousel. ${page.description}`
      : "";

    // Build image manifest so the model knows exactly what each reference image is
    // Prioritize logo by putting it first and emphasizing it
    const logoImages = referenceImages.filter((r) => r.role.includes("LOGO"));
    const otherImages = referenceImages.filter((r) => !r.role.includes("LOGO"));
    const orderedImages = [...logoImages, ...otherImages];

    const imageManifest = referenceImages.length > 0
      ? `\n## REFERENCE IMAGE MANIFEST\nYou are receiving ${referenceImages.length} reference images alongside this prompt. Here is what each one is:\n${orderedImages.map((r) => `- ${r.role}`).join("\n")}\n\nCRITICAL INSTRUCTIONS FOR REFERENCE IMAGES:\n1. LOGO: The school logo reference image(s) MUST be reproduced EXACTLY — copy every detail, color, shape, icon, and text within the logo precisely. Do NOT redraw or reinterpret the logo.\n2. HEADER: Reproduce the header bar from the reference, including school name and styling.\n3. FOOTER: Reproduce the footer bar from the reference, including contact information.\n4. SAMPLE POSTERS: These show the quality standard and design language to match. Study their layout, typography mixing, and visual richness.\n5. The final poster should look like it was designed by the same designer who made the sample posters.`
      : "";

    const rawPrompt = buildImagePrompt(input, page, pageContext) + imageManifest;

    // Prompt enhancer: expand the raw prompt into a highly detailed,
    // production-quality image generation prompt (like ChatGPT does internally)
    const enhanced = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert image prompt engineer. Your job is to take a poster design brief and expand it into a highly detailed, production-quality prompt for gpt-image-1.

Rules:
- Output ONLY the enhanced prompt text, nothing else
- Be extremely specific about: composition, layout, typography style, color usage, spacing, visual hierarchy, lighting, texture
- Specify exact positions (top-left, center, bottom-right, etc.)
- Describe typography: font style (sans-serif/serif), weight, size relative to poster, color, effects (shadow, outline)
- For Instagram posters: clean design, modern typography, strong visual hierarchy, breathing room, professional marketing quality
- Minimize text density — a poster should be visually driven, not text-heavy. Use only headline + one short line max
- Specify: "Instagram social media poster, portrait orientation 1080x1350px, high resolution, print-ready quality, professional graphic design"
- If there are uploaded photos, say: "Incorporate the provided reference photographs exactly as they are, without any modification, into a collage/featured layout"
- Describe the poster as a finished design, not a concept`,
        },
        { role: "user", content: rawPrompt },
      ],
      max_tokens: 1500,
    });

    const prompt = enhanced.choices[0]?.message?.content ?? rawPrompt;
    prompts.push(prompt);

    // Instagram portrait: 1024x1536 is the closest API size to 1080x1350 (4:5)
    const imageSize = "1024x1536" as const;

    // Single-pass generation (evaluate+refine handled in separate Inngest functions)
    let base64Result: string;

    if (referenceImages.length > 0) {
      // Put logo images first — the model gives more weight to earlier reference images
      const logoFirst = [
        ...referenceImages.filter((r) => r.role.includes("LOGO")),
        ...referenceImages.filter((r) => !r.role.includes("LOGO")),
      ];
      const referenceFiles = await Promise.all(
        logoFirst.map((img) =>
          toFile(img.buffer, img.name, { type: "image/png" }),
        ),
      );

      const response = await openai.images.edit({
        model: "gpt-image-1",
        image: referenceFiles,
        prompt,
        n: 1,
        size: imageSize,
        quality: "high",
      });

      const item = response.data?.[0];
      if (!item?.b64_json && !item?.url) {
        throw new Error(`Agent 3: no image returned for variation ${brief.variationIndex}, page ${i + 1}`);
      }
      base64Result = item.b64_json ?? "";
      if (!base64Result && item.url) {
        const res = await fetch(item.url);
        base64Result = Buffer.from(await res.arrayBuffer()).toString("base64");
      }
    } else {
      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: imageSize,
        quality: "high",
      });

      const item = response.data?.[0];
      if (!item?.b64_json && !item?.url) {
        throw new Error(`Agent 3: no image returned for variation ${brief.variationIndex}, page ${i + 1}`);
      }
      base64Result = item.b64_json ?? "";
      if (!base64Result && item.url) {
        const res = await fetch(item.url);
        base64Result = Buffer.from(await res.arrayBuffer()).toString("base64");
      }
    }

    imageUrls.push(`data:image/png;base64,${base64Result}`);
  }

  return {
    imageUrls,
    model: "gpt-image-1",
    prompts,
    referenceImageCount: referenceImages.length,
    refinementRounds: 0,
  };
}

function buildImagePrompt(
  input: Agent3Input,
  page: { description: string; selectedImages: { path: string; placement: string; size: string }[]; textOverlays: { text: string; position: string; style: string }[] } | undefined,
  pageContext: string,
): string {
  const { brief, understanding, schoolName, brandAssets, curatedImages } = input;

  const hasUploadedPhotos = curatedImages.length > 0 && brief.selectedImages.length > 0;

  const textOverlays = page?.textOverlays
    ?.map((t) => `- "${t.text}" at ${t.position} in ${t.style} style`)
    .join("\n") ?? "";

  // Brand assets present as reference images
  const brandRefDescriptions = brandAssets
    .filter((a) => ["logo", "header", "footer"].includes(a.assetType))
    .map((a) => `- ${a.assetType}: provided as reference image`)
    .join("\n");

  const hasSamples = brandAssets.some((a) => a.assetType === "sample");
  const sampleSection = hasSamples
    ? `\n## STYLE REFERENCE — Sample posters are provided as reference images.\nMatch the same level of visual quality, layout structure, and design polish as these samples. Study their typography, composition, and branding integration closely.`
    : "";

  let photoSection: string;
  let assetRules: string;

  if (hasUploadedPhotos) {
    // MODE A: Teacher uploaded photos — use as-is, do not transform
    const imageDescriptions = brief.selectedImages
      .map((img) => {
        const curated = understanding.curatedImages.find((c) => c.path === img.path);
        return curated
          ? `- ${curated.description} (placed: ${img.placement})`
          : `- Image at ${img.path} (placed: ${img.placement})`;
      })
      .join("\n");

    photoSection = `## Uploaded Photos (provided as reference images):
${imageDescriptions}

CRITICAL RULES FOR UPLOADED PHOTOS:
- These are REAL photographs taken by the teacher. They are provided as reference images.
- You MUST include these photos in the poster EXACTLY as they are — do NOT transform, edit, filter, redraw, or replace them with AI-generated versions.
- Do NOT add uniforms, accessories, or any modifications to people in these photos.
- Do NOT alter faces, bodies, backgrounds, or any part of the uploaded photos.
- Arrange them in the poster layout (collage, grid, featured) but preserve them as-is.
- You may add borders, frames, or decorative elements AROUND the photos, but never alter the photos themselves.`;

    assetRules = `## School Brand Assets:
${brandRefDescriptions || "(No brand assets)"}

BRANDING RULES:
- Use the school's actual LOGO from the reference images at ${brief.logoPlacement.position}, ${brief.logoPlacement.size}.
- HEADER must appear at the top of EVERY page. Use the provided header and adapt its style to the theme.
- FOOTER must appear at the bottom of EVERY page. Use the provided footer and adapt its style to the theme.
- Do NOT use uniform or infrastructure assets — this poster uses real uploaded photos.`;

  } else {
    // MODE B: No uploaded photos — AI generates everything from scratch
    const styleAssets = brandAssets
      .filter((a) => ["uniform", "infrastructure"].includes(a.assetType))
      .map((a) => `- ${a.assetType}: provided as reference image — use as style/visual guide`)
      .join("\n");

    photoSection = `## No Uploaded Photos
This is an event-based poster. Generate ALL imagery from scratch to match the theme.
${brief.schoolAssetUsage.useUniform ? `- When generating students, they MUST wear the school uniform. A uniform reference image is provided — match it precisely.
- ${brief.schoolAssetUsage.uniformNotes}` : ""}
${brief.schoolAssetUsage.useInfrastructure ? `- Use the school infrastructure/campus images as visual reference for the setting.
- ${brief.schoolAssetUsage.infrastructureNotes}` : ""}`;

    assetRules = `## School Brand Assets:
${brandRefDescriptions || "(No brand assets)"}
${styleAssets ? `\n## Style Reference Assets:\n${styleAssets}` : ""}

BRANDING RULES:
- Use the school's actual LOGO from the reference images at ${brief.logoPlacement.position}, ${brief.logoPlacement.size}.
- HEADER must appear at the top of EVERY page. Use the provided header and adapt its style to the theme.
- FOOTER must appear at the bottom of EVERY page. Use the provided footer and adapt its style to the theme.
- All AI-generated imagery should match the school's visual identity (uniform colors, campus look).`;
  }

  return `Create a professional Instagram poster for ${schoolName}.

## Creative Direction: ${brief.direction}
## Theme: ${brief.theme}
## Color Palette: ${brief.colorPalette.join(", ")}

## Text Content:
- Headline: "${brief.textContent.headline}"
- Subheadline: "${brief.textContent.subheadline}"
${brief.textContent.bodyText ? `- Body: "${brief.textContent.bodyText}"` : ""}
${brief.textContent.callToAction ? `- CTA: "${brief.textContent.callToAction}"` : ""}

${textOverlays ? `## Text Overlays:\n${textOverlays}` : ""}

${photoSection}

${assetRules}

## LOGO — COPY EXACTLY FROM REFERENCE IMAGE
Place at ${brief.logoPlacement.position}, ${brief.logoPlacement.size}. Copy the logo EXACTLY as it appears in the reference image. Do NOT redraw, reinterpret, or simplify it.

## HEADER (MANDATORY at top of every page)
Style: ${brief.headerFooter.headerStyle}
Copy the header from the reference image exactly as shown.

## FOOTER (MANDATORY at bottom of every page)
Style: ${brief.headerFooter.footerStyle}
Copy the footer from the reference image exactly as shown.

${pageContext}

${sampleSection}

## Design Prompt:
${brief.designPrompt}

FORMAT: Instagram social media poster, portrait orientation 1080x1350px (4:5 ratio), high resolution, print-ready, professional graphic design.
STYLE: Clean modern design, strong visual hierarchy, generous whitespace, minimal text (headline + one short tagline MAX). The poster should be VISUAL-DRIVEN, not text-heavy. Think premium magazine ad, not a flyer.
TYPOGRAPHY: Modern sans-serif, bold headline, clean readable type with good contrast against background. No more than 2 lines of text total.
QUALITY: Ultra high quality, commercial advertising standard, polished and professional.`;
}

/**
 * Refines a prompt based on evaluator feedback, then regenerates the image.
 * Used by the evaluate+refine pipeline step.
 */
export async function refineAndRegenerate(
  originalPrompt: string,
  feedback: string,
  score: number,
  input: Agent3Input,
): Promise<{ base64: string; refinedPrompt: string }> {
  const openai = getOpenAI();

  // Refine the prompt
  const refined = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are an expert image prompt engineer. Rewrite the poster prompt to address the evaluator's feedback while keeping the core design intent. Output ONLY the improved prompt text.",
      },
      {
        role: "user",
        content: `Original prompt:\n${originalPrompt}\n\nEvaluator feedback (score: ${score}/10):\n${feedback}\n\nRewrite the prompt to fix these issues:`,
      },
    ],
    max_tokens: 1500,
  });

  let refinedPrompt = refined.choices[0]?.message?.content ?? originalPrompt;

  // Regenerate with the refined prompt
  const imageSize = "1024x1536" as const;
  const { brief } = input;

  // Re-use the same Agent 2-driven asset selection as runGenerationAgent
  const referenceImages: { buffer: Buffer; name: string; role: string }[] = [];
  let idx = 1;

  const selectedAssets = (brief as Record<string, unknown>).selectedAssets as {
    logo?: string | null; header?: string | null; footer?: string | null;
    uniform?: string | null; infrastructure?: string | null; samples?: string[];
  } | undefined;

  async function addRefAsset(storagePath: string | null | undefined, role: string, type: string): Promise<void> {
    if (!storagePath) return;
    const asset = input.brandAssets.find((a) =>
      a.storagePath === storagePath || a.storagePath.endsWith(storagePath) || storagePath.endsWith(a.storagePath.split("/").pop() ?? "")
    );
    if (!asset?.signedUrl) return;
    const buf = await downloadImage(asset.signedUrl);
    if (!buf) return;
    referenceImages.push({ buffer: buf, name: `image${idx}_${type}.png`, role: `IMAGE ${idx}: ${role}` });
    idx++;
  }

  if (selectedAssets) {
    await addRefAsset(selectedAssets.logo, "SCHOOL LOGO — Copy EXACTLY", "logo");
    await addRefAsset(selectedAssets.header, "SCHOOL HEADER", "header");
    await addRefAsset(selectedAssets.footer, "SCHOOL FOOTER", "footer");
    await addRefAsset(selectedAssets.uniform, "UNIFORM REFERENCE", "uniform");
    await addRefAsset(selectedAssets.infrastructure, "INFRASTRUCTURE REFERENCE", "infrastructure");
    for (const sp of selectedAssets.samples ?? []) await addRefAsset(sp, "STYLE REFERENCE POSTER", "sample");
  } else {
    for (const type of ["logo", "header", "footer"] as const) {
      const a = input.brandAssets.find((x) => x.assetType === type);
      if (a) await addRefAsset(a.storagePath, `SCHOOL ${type.toUpperCase()}`, type);
    }
  }

  // Uploaded photos
  const hasUploadedPhotos = input.curatedImages.length > 0 && brief.selectedImages.length > 0;
  if (hasUploadedPhotos) {
    const selectedPaths = new Set(brief.selectedImages.map((s) => s.path));
    for (const img of input.curatedImages) {
      const fn = img.path.split("/").pop() ?? "";
      const isSelected = selectedPaths.has(img.path) || [...selectedPaths].some((p) => img.path.endsWith(p) || p.endsWith(fn));
      if (isSelected) {
        const buf = await downloadImage(img.signedUrl);
        if (buf) { referenceImages.push({ buffer: buf, name: `image${idx}_photo.png`, role: `IMAGE ${idx}: UPLOADED PHOTO — "${fn}"` }); idx++; }
      }
    }
  }

  // Add manifest to the refined prompt
  if (referenceImages.length > 0) {
    const manifest = `\n\nREFERENCE IMAGE MANIFEST:\n${referenceImages.map((r) => `- ${r.role}`).join("\n")}\nUse these reference images as described.`;
    refinedPrompt += manifest;
  }

  let base64: string;

  if (referenceImages.length > 0) {
    const files = await Promise.all(
      referenceImages.map((img) => toFile(img.buffer, img.name, { type: "image/png" })),
    );
    const response = await openai.images.edit({
      model: "gpt-image-1", image: files, prompt: refinedPrompt, n: 1, size: imageSize, quality: "high",
    });
    const item = response.data?.[0];
    base64 = item?.b64_json ?? "";
    if (!base64 && item?.url) {
      base64 = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  } else {
    const response = await openai.images.generate({
      model: "gpt-image-1", prompt: refinedPrompt, n: 1, size: imageSize, quality: "high",
    });
    const item = response.data?.[0];
    base64 = item?.b64_json ?? "";
    if (!base64 && item?.url) {
      base64 = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  }

  if (!base64) throw new Error("Refinement: no image returned");
  return { base64, refinedPrompt };
}
