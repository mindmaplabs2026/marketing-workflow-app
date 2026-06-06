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
 * Compares the output against reference images (logo, header, footer,
 * uploaded photos, samples) to check accuracy, not just generic quality.
 */
export async function evaluatePoster(
  imageBase64: string,
  brief: VariationBrief,
  schoolName: string,
  referenceImages?: { role: string; base64: string }[],
): Promise<EvaluationResult> {
  const openai = getOpenAI();

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" | "low" } }
  > = [];

  // First: show the reference images so the evaluator knows what to compare against
  if (referenceImages && referenceImages.length > 0) {
    userContent.push({
      type: "text",
      text: `REFERENCE IMAGES — compare the generated poster against these:\n${referenceImages.map((r) => `- ${r.role}`).join("\n")}`,
    });
    for (const ref of referenceImages) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${ref.base64}`, detail: "low" },
      });
      userContent.push({
        type: "text",
        text: `[${ref.role}]`,
      });
    }
  }

  // Then: show the generated poster to evaluate
  userContent.push({
    type: "text",
    text: `\nGENERATED POSTER TO EVALUATE:\nSchool: ${schoolName}\nTheme: ${brief.theme}\nDirection: ${brief.direction}\nHeadline: ${brief.textContent.headline}`,
  });
  userContent.push({
    type: "image_url",
    image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "high" },
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a professional graphic design quality assessor for school marketing posters on Instagram.

You will receive REFERENCE IMAGES first (logo, header, footer, sample posters, uploaded photos), then the GENERATED POSTER to evaluate.

Score the poster from 1-10 on these criteria:
- Logo accuracy: does the logo in the poster match the reference logo exactly? Same shape, colors, text?
- Header/footer accuracy: do they match the reference header and footer?
- Uploaded photo usage: if uploaded photos were provided, are they included as-is (not redrawn)?
- Style match: does the design quality match the sample poster references?
- Typography: is text legible, well-sized, not too much text?
- Layout: clean composition, clear visual hierarchy, breathing room?
- Theme relevance: does the imagery match the intended theme?
- Instagram readiness: would this perform well as an Instagram post?

Return ONLY valid JSON:
{
  "score": 1-10,
  "feedback": "specific actionable improvements — be precise. If the logo doesn't match, say so. If uploaded photos were redrawn instead of included, say so. If the style doesn't match the samples, explain how.",
  "passesThreshold": true/false (true if score >= ${QUALITY_THRESHOLD})
}`,
      },
      { role: "user", content: userContent },
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
      ? `\n\nReference images provided (${referenceImages.length} total):\n${orderedImages.map((r) => `- ${r.role}`).join("\n")}\n\nCopy the LOGO exactly. Copy the HEADER and FOOTER exactly. Match the SAMPLE POSTERS' design quality.`
      : "";

    const rawPrompt = buildImagePrompt(input, page, pageContext);

    // Prompt enhancer: expand ONLY the creative direction.
    // The manifest is appended AFTER enhancement so the enhancer can't
    // rewrite, summarize, or drop reference image instructions.
    const enhanced = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert image prompt engineer. Expand the poster brief into a richly detailed visual prompt.

Rules:
- Output ONLY the enhanced prompt, nothing else
- Expand the creative vision with specific visual details: composition, lighting, textures, color gradients, spacing, depth, mood
- Be specific about layout: where elements sit, how the eye flows, what's in the foreground vs background
- Keep all text content exactly as specified (headline, tagline) — do NOT add or change text
- Format: Instagram portrait 1080x1350px, print-ready, professional
- Preserve all logo, header, footer, and photo placement instructions exactly as given`,
        },
        { role: "user", content: rawPrompt },
      ],
      max_tokens: 1500,
    });

    const enhancedPrompt = enhanced.choices[0]?.message?.content ?? rawPrompt;

    // Append manifest AFTER enhancement — this is the single source of truth
    // for reference images and must reach the image model exactly as-is
    const prompt = enhancedPrompt + imageManifest;
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
      // Filter out any invalid buffers before converting to files
      const validImages = logoFirst.filter((img) => img.buffer && img.buffer.length > 0);
      if (validImages.length === 0) {
        throw new Error(`Agent 3: no valid reference images for variation ${brief.variationIndex}`);
      }
      const referenceFiles = await Promise.all(
        validImages.map((img) =>
          toFile(img.buffer, img.name, { type: "image/png" }),
        ),
      );

      let response;
      try {
        response = await openai.images.edit({
          model: "gpt-image-2",
          image: referenceFiles,
          prompt,
          n: 1,
          size: imageSize,
          quality: "high",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`OpenAI images.edit failed for variation ${brief.variationIndex}, page ${i + 1}:`, msg);
        throw new Error(`Image generation failed: ${msg}`);
      }

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
      let response;
      try {
        response = await openai.images.generate({
          model: "gpt-image-2",
          prompt,
          n: 1,
          size: imageSize,
          quality: "high",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`OpenAI images.generate failed for variation ${brief.variationIndex}, page ${i + 1}:`, msg);
        throw new Error(`Image generation failed: ${msg}`);
      }

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
    model: "gpt-image-2",
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
  const { brief, understanding, schoolName, curatedImages } = input;

  const hasUploadedPhotos = curatedImages.length > 0 && brief.selectedImages.length > 0;

  // Use creativeVision as primary (rich narrative), fall back to designPrompt
  const briefAny = brief as Record<string, unknown>;
  const creativeVision = (briefAny.creativeVision as string) ?? "";
  const designPrompt = brief.designPrompt ?? "";

  // Build uploaded photo details with descriptions from Agent 1
  let photoSection = "";
  if (hasUploadedPhotos) {
    const photoDetails = brief.selectedImages
      .map((img) => {
        const curated = understanding.curatedImages.find((c) => c.path === img.path);
        const desc = curated?.description ?? "uploaded photo";
        return `- "${img.path.split("/").pop()}" → placement: ${img.placement}. Content: ${desc}`;
      })
      .join("\n");

    photoSection = `## Uploaded Photos (provided as reference images)
These are REAL photographs. Include them in the poster EXACTLY as they are.
Do NOT redraw, modify, filter, or replace them with AI-generated versions.
${photoDetails}`;
  } else {
    photoSection = `No uploaded photos — generate all imagery from scratch.${brief.schoolAssetUsage.useUniform ? "\nStudents MUST wear the school uniform from the uniform reference image." : ""}${brief.schoolAssetUsage.useInfrastructure ? "\nUse the infrastructure reference image for campus setting." : ""}`;
  }

  return `Instagram poster for ${schoolName}. Portrait 1080x1350px, print-ready, professional.

## Creative Vision
${creativeVision || designPrompt}

## Technical Details
Direction: ${brief.direction}
Theme: ${brief.theme}
Palette: ${brief.colorPalette.join(", ")}
Headline: "${brief.textContent.headline}"
${brief.textContent.subheadline ? `Tagline: "${brief.textContent.subheadline}"` : ""}

Logo: copy EXACTLY from reference image → ${brief.logoPlacement.position}, ${brief.logoPlacement.size}
Header: copy from reference image → top. ${brief.headerFooter.headerStyle}
Footer: copy from reference image → bottom. ${brief.headerFooter.footerStyle}

${photoSection}
${pageContext ? `\n${pageContext}` : ""}

Maximum 2 lines of text on the poster. Visual-driven, premium quality.`;
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
    const validImages = referenceImages.filter((img) => img.buffer && img.buffer.length > 0);
    const files = await Promise.all(
      validImages.map((img) => toFile(img.buffer, img.name, { type: "image/png" })),
    );
    let response;
    try {
      response = await openai.images.edit({
        model: "gpt-image-2", image: files, prompt: refinedPrompt, n: 1, size: imageSize, quality: "high",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Refinement images.edit failed:", msg);
      throw new Error(`Refinement image generation failed: ${msg}`);
    }
    const item = response.data?.[0];
    base64 = item?.b64_json ?? "";
    if (!base64 && item?.url) {
      base64 = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  } else {
    let response;
    try {
      response = await openai.images.generate({
        model: "gpt-image-2", prompt: refinedPrompt, n: 1, size: imageSize, quality: "high",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Refinement images.generate failed:", msg);
      throw new Error(`Refinement image generation failed: ${msg}`);
    }
    const item = response.data?.[0];
    base64 = item?.b64_json ?? "";
    if (!base64 && item?.url) {
      base64 = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  }

  if (!base64) throw new Error("Refinement: no image returned");
  return { base64, refinedPrompt };
}
