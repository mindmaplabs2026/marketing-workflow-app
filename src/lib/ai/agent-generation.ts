import "server-only";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import { getModelEngineKind } from "../config/engine";
import {
  defaultPhotoFrames,
  renderDeterministicPosterPage,
} from "./poster-compositor";
import type { CostTracker } from "./cost-tracker";
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
  costTracker?: CostTracker,
): Promise<EvaluationResult> {
  const openai = await getModelClient();

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

  const response = await withRateLimitRetry(() => openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `You are a professional graphic design quality assessor for school marketing posters on Instagram.

You will receive REFERENCE IMAGES first (logo, header, footer, sample posters, uploaded photos), then the GENERATED POSTER to evaluate.

Score the poster from 1-10 on these criteria:
- Logo accuracy (if a logo reference is provided): does the logo in the poster match the reference logo exactly? Same shape, colors, text?
- School branding: is the school name, affiliations, and contact information present and readable?
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
  }));

  costTracker?.addLLMCall("evaluator", "gpt-4o-mini", response.usage);

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
  costTracker?: CostTracker,
): Promise<GenerationResult> {
  const openai = await getModelClient();
  const { brief } = input;

  const pages =
    brief.layout.type === "carousel" ? brief.layout.pages : [brief.layout.pages[0]];

  const imageUrls: string[] = [];
  const prompts: string[] = [];

  // Use ONLY the assets that Agent 2 (creative director) selected.
  // Agent 2 outputs selectedAssets with exact storage_paths for each role.
  // No random sampling, no "always include all" — just what was picked.

  const referenceImages: { buffer: Buffer; name: string; role: string; sourcePath?: string }[] = [];
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

  // Track which assets Agent 2 actually selected (may be null if redundant)
  let hasLogo = false;
  let hasHeader = false;
  let hasFooter = false;

  if (selectedAssets) {
    // Agent 2 specified exactly which assets to use (null means intentionally skipped)
    if (selectedAssets.logo) { await addAsset(selectedAssets.logo, "SCHOOL LOGO — Reproduce this logo accurately in the poster", "logo"); hasLogo = referenceImages.some((r) => r.role.includes("LOGO")); }
    if (selectedAssets.header) { await addAsset(selectedAssets.header, "SCHOOL BRANDING SOURCE — Extract school name, affiliation, and branding text from this image", "header"); hasHeader = referenceImages.some((r) => r.role.includes("BRANDING SOURCE")); }
    if (selectedAssets.footer) { await addAsset(selectedAssets.footer, "SCHOOL CONTACT SOURCE — Extract contact details (phone, website, address) from this image", "footer"); hasFooter = referenceImages.some((r) => r.role.includes("CONTACT SOURCE")); }
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
      if (asset) {
        await addAsset(asset.storagePath, `SCHOOL ${assetType.toUpperCase()}`, assetType);
        if (assetType === "logo") hasLogo = true;
        if (assetType === "header") hasHeader = true;
        if (assetType === "footer") hasFooter = true;
      }
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

  // Add uploaded photos selected by Agent 2.
  // For carousel, Agent 2 assigns photos at page level (layout.pages[].selectedImages),
  // not brief level. Collect from both to build the complete set.
  const allSelectedPaths = new Set<string>();
  for (const img of brief.selectedImages ?? []) {
    if (img?.path) allSelectedPaths.add(img.path);
  }
  if (brief.layout?.pages) {
    for (const p of brief.layout.pages) {
      for (const img of p.selectedImages ?? []) {
        if (img?.path) allSelectedPaths.add(img.path);
      }
    }
  }

  console.log(`[Agent3] Reference images: ${allSelectedPaths.size} selected paths, ${input.curatedImages.length} curated available`);

  // Download uploaded photos as reference images.
  // If Agent 2 specified which photos to use (allSelectedPaths), filter to those.
  // If Agent 2 failed to assign paths (all undefined), fall back to ALL curated images.
  const hasUploadedPhotos = input.curatedImages.length > 0;
  if (hasUploadedPhotos) {
    const useAll = allSelectedPaths.size === 0; // Agent 2 didn't assign any — use all curated
    if (useAll) {
      console.warn(`[Agent3] Agent 2 assigned 0 photo paths — falling back to ALL ${input.curatedImages.length} curated images`);
    }
    for (const img of input.curatedImages) {
      const imgFilename = img.path.split("/").pop() ?? "";
      const isSelected = useAll || allSelectedPaths.has(img.path) ||
        [...allSelectedPaths].some((p) => img.path.endsWith(p) || p.endsWith(imgFilename));
      if (isSelected) {
        const buf = await downloadImage(img.signedUrl);
        if (buf) {
          referenceImages.push({
            buffer: buf,
            name: `image${imageIndex}_photo.png`,
            role: `IMAGE ${imageIndex}: UPLOADED PHOTO — "${imgFilename}". Include this photo AS-IS. Do NOT modify or redraw it.`,
            sourcePath: img.path,
          });
          imageIndex++;
        }
      }
    }
  }

  const photoCount = referenceImages.filter((r) => r.role.includes("UPLOADED PHOTO")).length;
  const brandCount = referenceImages.filter((r) => !r.role.includes("UPLOADED PHOTO")).length;
  console.log(`[Agent3] Total reference images: ${referenceImages.length} (${brandCount} brand assets, ${photoCount} photos)`);

  // For carousels, per-page vision comes from page.creativeVision directly.
  // Top-level creativeVision contains shared visual consistency rules only.
  const briefAny = brief as Record<string, unknown>;
  const fullCreativeVision = (briefAny.creativeVision as string) ?? "";
  const isCarousel = brief.layout.type === "carousel";
  const brandRefImages = referenceImages.filter((r) => !r.role.includes("UPLOADED PHOTO"));

  /**
   * Generate a single page — extracted so carousel pages can run in parallel.
   */
  async function generateOnePage(i: number): Promise<{ base64: string; prompt: string }> {
    const pageStartTime = Date.now();
    console.log(`[Agent3] Page ${i + 1}/${pages.length} generation STARTED at ${new Date().toISOString()}`);

    const page = pages[i];

    // For carousels: build per-page reference images (brand assets shared, photos per-page)
    const pagePhotoImages: typeof referenceImages = [];
    if (isCarousel && page?.selectedImages?.length) {
      const pagePhotoPaths = new Set(
        page.selectedImages.map((s) => s?.path).filter((p): p is string => !!p)
      );
      for (const ref of referenceImages) {
        if (!ref.role.includes("UPLOADED PHOTO") || !ref.sourcePath) continue;
        const refFilename = ref.sourcePath.split("/").pop() ?? "";
        const isForThisPage = pagePhotoPaths.has(ref.sourcePath) ||
          [...pagePhotoPaths].some((p) => {
            const pFilename = p.split("/").pop() ?? "";
            return ref.sourcePath === p ||
              ref.sourcePath!.endsWith(p) ||
              p.endsWith(refFilename) ||
              pFilename === refFilename;
          });
        if (isForThisPage) pagePhotoImages.push(ref);
      }
    }

    const photoRefImages = isCarousel && page?.selectedImages?.length
      ? pagePhotoImages
      : referenceImages.filter((r) => r.role.includes("UPLOADED PHOTO"));
    const pageReferenceImages = [...brandRefImages, ...photoRefImages];

    console.log(`[Agent3] Page ${i + 1}: ${brandRefImages.length} brand + ${photoRefImages.length} photos = ${pageReferenceImages.length} refs | vision=${page?.creativeVision ? `${page.creativeVision.length}ch` : "none"}`);

    const logoImgs = pageReferenceImages.filter((r) => r.role.includes("LOGO"));
    const otherImgs = pageReferenceImages.filter((r) => !r.role.includes("LOGO"));
    const orderedImages = [...logoImgs, ...otherImgs];

    const copyInstructions = [
      hasLogo ? "Reproduce the SCHOOL LOGO accurately" : null,
      hasHeader ? "Extract school name and branding from the BRANDING SOURCE image" : null,
      hasFooter ? "Extract contact details from the CONTACT SOURCE image" : null,
      "Match the SAMPLE POSTERS' design quality",
    ].filter(Boolean).join(". ");

    const imageManifest = pageReferenceImages.length > 0
      ? `\n\nReference images provided (${pageReferenceImages.length} total):\n${orderedImages.map((r) => `- ${r.role}`).join("\n")}\n\n${copyInstructions}.`
      : "";

    const rawPrompt = buildImagePrompt(input, page, i, pages.length, fullCreativeVision, { hasLogo, hasHeader, hasFooter });

    // Count photos assigned to this page for the enhancer
    const pagePhotoCount = photoRefImages.length;

    const enhancerSystemPrompt = isCarousel
      ? `You are an expert image prompt engineer. Expand the poster brief into a richly detailed visual prompt for ONE PAGE of a carousel.

Rules:
- Output ONLY the enhanced prompt, nothing else
- This is page ${i + 1} of ${pages.length} — focus on THIS page's specific content and layout
- CRITICAL: The header and footer MUST be copied EXACTLY from reference images and reproduced identically on every page — do NOT modify, restyle, or reinterpret them. Preserve their exact appearance.
- CRITICAL: This page has ${pagePhotoCount} uploaded photos as reference images. Include ALL ${pagePhotoCount} of them. Do NOT replace uploaded photos with AI-generated people or scenes.
- Maintain the EXACT same visual style across pages — same background, borders, typography, colors
- Expand with specific visual details: composition, lighting, textures, color gradients, spacing
- Keep all text content exactly as specified — do NOT add or change text
- Format: Instagram portrait 1080x1350px, print-ready, professional
- Preserve all photo count, placement, header, and footer instructions exactly as given`
      : `You are an expert image prompt engineer. Expand the poster brief into a richly detailed visual prompt.

Rules:
- Output ONLY the enhanced prompt, nothing else
- Expand the creative vision with specific visual details: composition, lighting, textures, color gradients, spacing, depth, mood
- Be specific about layout: where elements sit, how the eye flows, what's in the foreground vs background
- Keep all text content exactly as specified (headline, tagline) — do NOT add or change text
- Format: Instagram portrait 1080x1350px, print-ready, professional
- Preserve all logo, header, footer, and photo placement instructions exactly as given`;

    const enhanced = await withRateLimitRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: enhancerSystemPrompt },
          { role: "user", content: rawPrompt },
        ],
        max_tokens: 1500,
      }),
    );

    costTracker?.addLLMCall(`agent3_enhancer_p${i + 1}`, "gpt-4o-mini", enhanced.usage);

    const enhancedPrompt = enhanced.choices[0]?.message?.content ?? rawPrompt;
    const prompt = enhancedPrompt + imageManifest;
    console.log(`[Agent3] Page ${i + 1}/${pages.length} prompt enhanced at ${new Date().toISOString()} (${((Date.now() - pageStartTime) / 1000).toFixed(1)}s elapsed)`);

    const imageSize = "1024x1536" as const;
    let base64Result: string;

    if (pageReferenceImages.length > 0) {
      const logoFirst = [
        ...pageReferenceImages.filter((r) => r.role.includes("LOGO")),
        ...pageReferenceImages.filter((r) => !r.role.includes("LOGO")),
      ];
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
        throw new Error(`Image generation failed (page ${i + 1}): ${msg}`);
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
        throw new Error(`Image generation failed (page ${i + 1}): ${msg}`);
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

    costTracker?.addImageCall(`agent3_image_p${i + 1}`, 1, imageSize);

    console.log(`[Agent3] Page ${i + 1}/${pages.length} generation COMPLETE at ${new Date().toISOString()} (${((Date.now() - pageStartTime) / 1000).toFixed(1)}s total)`);
    return { base64: base64Result, prompt };
  }

  // Generate all pages sequentially. Page 1 is evaluated and optionally refined.
  // For pages 2+: Codex uses codexCarouselPage (vision-based style matching),
  // OpenAI adds page 1 as a style reference via -i.
  const isCodexEngine = getModelEngineKind() === "codex";
  console.log(`[Agent3] Starting ${pages.length} page(s) sequentially at ${new Date().toISOString()}`);
  const allPagesStart = Date.now();
  const pageResults: { base64: string; prompt: string }[] = [];
  let refinementRounds = 0;

  // --- Page 1 ---
  let page1Result = await generateOnePage(0);

  // Evaluate page 1 and refine if below threshold
  const evalRefImages = referenceImages.map((r) => ({
    role: r.role,
    base64: r.buffer.toString("base64"),
  }));
  const evalResult = await evaluatePoster(
    page1Result.base64,
    brief,
    input.schoolName,
    evalRefImages,
    costTracker,
  );
  console.log(`[Agent3] Page 1 evaluation: score=${evalResult.score}, passes=${evalResult.passesThreshold}`);

  if (!evalResult.passesThreshold) {
    console.log(`[Agent3] Page 1 below threshold (${evalResult.score}/${QUALITY_THRESHOLD}), refining...`);
    const refined = await refineAndRegenerate(
      page1Result.prompt,
      evalResult.feedback,
      evalResult.score,
      input,
      costTracker,
    );
    page1Result = { base64: refined.base64, prompt: refined.refinedPrompt };
    refinementRounds++;
  }

  pageResults.push(page1Result);

  // --- Pages 2+ ---
  for (let i = 1; i < pages.length; i++) {
    if (isCodexEngine) {
      const { codexCarouselPage } = await import("./codex-carousel-page");
      const page1Buf = Buffer.from(page1Result.base64, "base64");

      // Build per-page photo buffers
      const page = pages[i];
      const pagePhotoPaths = new Set(
        (page?.selectedImages ?? []).map((s) => s?.path).filter((p): p is string => !!p)
      );
      const pagePhotoBuffers: { name: string; buffer: Buffer }[] = [];
      for (const ref of referenceImages) {
        if (!ref.role.includes("UPLOADED PHOTO") || !ref.sourcePath) continue;
        const refFilename = ref.sourcePath.split("/").pop() ?? "";
        const isForThisPage = pagePhotoPaths.size === 0 || pagePhotoPaths.has(ref.sourcePath) ||
          [...pagePhotoPaths].some((p) => ref.sourcePath === p || p.endsWith(refFilename));
        if (isForThisPage) {
          pagePhotoBuffers.push({ name: ref.name, buffer: ref.buffer });
        }
      }

      // Build brand asset buffers
      const brandAssetBuffers = brandRefImages.map((r) => ({
        name: r.name,
        buffer: r.buffer,
        role: r.role,
      }));

      // Build the page prompt
      const pagePrompt = buildImagePrompt(input, page, i, pages.length, fullCreativeVision, { hasLogo, hasHeader, hasFooter });

      const codexBase64 = await codexCarouselPage({
        page1Image: page1Buf,
        pagePhotos: pagePhotoBuffers,
        brandAssets: brandAssetBuffers,
        prompt: pagePrompt,
        pageNumber: i + 1,
        totalPages: pages.length,
      });
      pageResults.push({ base64: codexBase64, prompt: pagePrompt });
    } else {
      // OpenAI: page 1 output as additional style reference
      const page1Buf = Buffer.from(page1Result.base64, "base64");
      referenceImages.push({
        buffer: page1Buf,
        name: `image${referenceImages.length + 1}_page1ref.png`,
        role: `IMAGE ${referenceImages.length + 1}: PAGE 1 STYLE REFERENCE — Match this exact visual style, background, borders, typography, header and footer`,
      });
      const result = await generateOnePage(i);
      pageResults.push(result);
    }
  }

  console.log(`[Agent3] All ${pages.length} page(s) complete in ${((Date.now() - allPagesStart) / 1000).toFixed(1)}s`);

  for (const result of pageResults) {
    imageUrls.push(`data:image/png;base64,${result.base64}`);
    prompts.push(result.prompt);
  }

  return {
    imageUrls,
    model: "gpt-image-2",
    prompts,
    referenceImageCount: referenceImages.length,
    refinementRounds,
  };
}

/**
 * V2 local poster generation: generate a designed background/slot layer, then
 * composite original uploaded photos afterward. This keeps people/faces out of
 * the generative edit pass, so the model cannot redraw them.
 */
export async function runGenerationAgentV2(
  input: Agent3Input,
  costTracker?: CostTracker,
): Promise<GenerationResult> {
  const { brief } = input;
  const pages =
    brief.layout.type === "carousel" ? brief.layout.pages : [brief.layout.pages[0]];

  const imageUrls: string[] = [];
  const prompts: string[] = [];
  const brandImages: { buffer: Buffer; assetType: string }[] = [];
  let imageIndex = 1;

  const selectedAssets = (brief as Record<string, unknown>).selectedAssets as {
    logo?: string | null;
    header?: string | null;
    footer?: string | null;
    uniform?: string | null;
    infrastructure?: string | null;
    samples?: string[];
  } | undefined;

  async function addAsset(storagePath: string | null | undefined, role: string, assetType: string): Promise<void> {
    if (!storagePath) return;
    const asset = input.brandAssets.find((a) =>
      a.storagePath === storagePath ||
      a.storagePath.endsWith(storagePath) ||
      storagePath.endsWith(a.storagePath.split("/").pop() ?? ""),
    );
    if (!asset?.signedUrl) return;
    const buf = await downloadImage(asset.signedUrl);
    if (!buf) return;
    const label = asset.label ?? asset.storagePath.split("/").pop() ?? assetType;
    brandImages.push({
      buffer: buf,
      assetType,
    });
    console.log(`[Agent3:v2] Brand asset ${imageIndex}: ${role} — "${label}"`);
    imageIndex++;
  }

  if (selectedAssets) {
    if (selectedAssets.logo) {
      await addAsset(selectedAssets.logo, "SCHOOL LOGO — Reproduce this logo accurately", "logo");
    }
    if (selectedAssets.header) {
      await addAsset(selectedAssets.header, "SCHOOL BRANDING SOURCE — Extract school name and affiliations", "header");
    }
    if (selectedAssets.footer) {
      await addAsset(selectedAssets.footer, "SCHOOL CONTACT SOURCE — Extract contact details", "footer");
    }
    await addAsset(selectedAssets.uniform, "UNIFORM REFERENCE — Use only if no uploaded photos are provided", "uniform");
    await addAsset(selectedAssets.infrastructure, "INFRASTRUCTURE REFERENCE — Use as setting/background guide", "infrastructure");
    for (const samplePath of selectedAssets.samples ?? []) {
      await addAsset(samplePath, "STYLE REFERENCE POSTER — Match design quality and layout", "sample");
    }
  } else {
    for (const assetType of ["logo", "header", "footer"] as const) {
      const asset = input.brandAssets.find((a) => a.assetType === assetType);
      if (asset) {
        await addAsset(asset.storagePath, `SCHOOL ${assetType.toUpperCase()}`, assetType);
      }
    }
  }

  const photoBuffers = new Map<string, Buffer>();
  for (const img of input.curatedImages) {
    const buf = await downloadImage(img.signedUrl);
    if (buf) photoBuffers.set(img.path, buf);
  }

  function pathsForPage(page: typeof pages[number] | undefined): string[] {
    const raw = brief.layout.type === "carousel" && page?.selectedImages?.length
      ? page.selectedImages.map((img) => img.path).filter(Boolean)
      : (brief.selectedImages ?? []).map((img) => img.path).filter(Boolean);
    const wanted = raw.length > 0 ? raw : input.curatedImages.map((img) => img.path);
    const matched: string[] = [];
    for (const candidate of wanted) {
      const filename = candidate.split("/").pop() ?? "";
      const match = input.curatedImages.find((img) =>
        img.path === candidate ||
        img.path.endsWith(candidate) ||
        candidate.endsWith(img.path.split("/").pop() ?? "") ||
        img.path.split("/").pop() === filename,
      );
      if (match && photoBuffers.has(match.path)) matched.push(match.path);
    }
    return [...new Set(matched)];
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pagePaths = pathsForPage(page);
    const frames = defaultPhotoFrames(pagePaths, i, pages.length);
    console.log(`[Agent3:v2] Page ${i + 1}/${pages.length}: deterministic render with ${frames.length} photo frame(s)`);
    const photos = pagePaths
      .map((path) => {
        const buffer = photoBuffers.get(path);
        return buffer ? { path, buffer } : null;
      })
      .filter((p): p is { path: string; buffer: Buffer } => !!p);

    const finalBuffer = await renderDeterministicPosterPage({
      schoolName: input.schoolName,
      headline: i === 0 || pages.length === 1
        ? brief.textContent.headline
        : (page?.textOverlays?.[0]?.text || page?.description || brief.textContent.headline),
      subheadline: i === pages.length - 1 ? (brief.textContent.subheadline || brief.textContent.callToAction) : brief.textContent.subheadline,
      theme: brief.theme,
      palette: brief.colorPalette,
      pageIndex: i,
      totalPages: pages.length,
      photos,
      frames,
      brandImages,
    });

    imageUrls.push(`data:image/png;base64,${finalBuffer.toString("base64")}`);
    prompts.push(JSON.stringify({
      renderer: "deterministic-sharp-v2",
      page: i + 1,
      photoFrames: frames,
      photoCount: photos.length,
      headline: brief.textContent.headline,
      theme: brief.theme,
    }));
    console.log(`[Agent3:v2] Page ${i + 1}/${pages.length}: rendered ${photos.length} original photo(s)`);
  }

  return {
    imageUrls,
    model: "deterministic-sharp-v2",
    prompts,
    referenceImageCount: brandImages.length + photoBuffers.size,
    refinementRounds: 0,
  };
}

function buildImagePrompt(
  input: Agent3Input,
  page: { description: string; selectedImages: { path: string; placement: string; size: string }[]; textOverlays: { text: string; position: string; style: string }[]; creativeVision?: string; designPrompt?: string } | undefined,
  pageIndex: number,
  totalPages: number,
  topLevelCreativeVision: string,
  assets: { hasLogo: boolean; hasHeader: boolean; hasFooter: boolean } = { hasLogo: true, hasHeader: true, hasFooter: true },
  opts?: { photoSlotInstructions?: string },
): string {
  const { hasLogo, hasHeader, hasFooter } = assets;
  const { brief, understanding, schoolName, curatedImages } = input;
  const isCarousel = brief.layout.type === "carousel" && totalPages > 1;

  const designPrompt = brief.designPrompt ?? "";

  // For carousels: per-page creativeVision comes directly from the page object.
  // Top-level creativeVision contains only shared visual consistency rules.
  // For single: top-level creativeVision is the full vision.
  let visionSection: string;
  if (isCarousel) {
    const pageVision = page?.creativeVision || page?.description || "";
    const consistencyBlock = topLevelCreativeVision
      ? `## Visual Consistency (shared across ALL ${totalPages} pages)\n${topLevelCreativeVision}\n\n`
      : "";
    visionSection = `${consistencyBlock}## This Page (page ${pageIndex + 1} of ${totalPages})
${pageVision}

${page?.textOverlays?.length ? `Text on this page:\n${page.textOverlays.map((t) => `- "${t.text}" at ${t.position}, ${t.style}`).join("\n")}` : ""}`;
  } else {
    visionSection = topLevelCreativeVision || designPrompt;
  }

  // For carousels, prefer page-level selectedImages, fall back to brief-level, then to all curated
  const rawPageImages = isCarousel && page?.selectedImages?.length
    ? page.selectedImages.filter((img) => !!img?.path)
    : (brief.selectedImages ?? []).filter((img) => !!img?.path);

  // If Agent 2 didn't assign valid paths to this page, fall back to curated images
  const pageSelectedImages = rawPageImages.length > 0
    ? rawPageImages.map((img) => ({ path: img.path, placement: img.placement ?? "" }))
    : curatedImages.map((img) => ({ path: img.path, placement: "collage" }));

  const hasUploadedPhotos = curatedImages.length > 0 && pageSelectedImages.length > 0;

  // Build uploaded photo details with descriptions from Agent 1
  let photoSection = "";
  if (opts?.photoSlotInstructions) {
    photoSection = `## Uploaded Photo Slots
Uploaded photos are NOT provided to the image model and must NOT be generated.
The worker will paste the real original photos after this background is generated.
Design around these exact reserved slots and keep all text/branding outside them.
${opts.photoSlotInstructions}`;
  } else if (hasUploadedPhotos) {
    const photoDetails = pageSelectedImages
      .map((img) => {
        const curated = understanding.curatedImages.find((c) => c.path === img.path);
        const desc = curated?.description ?? "uploaded photo";
        return `- "${(img.path ?? "").split("/").pop()}" → placement: ${img.placement}. Content: ${desc}`;
      })
      .join("\n");

    photoSection = `## Uploaded Photos — ${pageSelectedImages.length} photos provided as reference images
IMPORTANT: This page has ${pageSelectedImages.length} uploaded photos. Include ALL ${pageSelectedImages.length} of them.
These are REAL photographs. Include them in the poster EXACTLY as they are.
Do NOT redraw, modify, filter, or replace them with AI-generated versions.
Do NOT add AI-generated people or photos — use ONLY the ${pageSelectedImages.length} provided photos.
${photoDetails}`;
  } else {
    photoSection = `No uploaded photos for this page — generate all imagery from scratch.${brief.schoolAssetUsage.useUniform ? "\nStudents MUST wear the school uniform from the uniform reference image." : ""}${brief.schoolAssetUsage.useInfrastructure ? "\nUse the infrastructure reference image for campus setting." : ""}`;
  }

  // Page-level design prompt from creative agent (contains photo count guidance)
  const pageDesignPrompt = (page as Record<string, unknown> | undefined)?.designPrompt as string | undefined;

  // Extract brandingPlacement from brief if available
  const brandingPlacement = (brief as Record<string, unknown>).brandingPlacement as {
    schoolName?: string;
    contactInfo?: string;
    affiliations?: string;
  } | undefined;

  const carouselNote = isCarousel
    ? `\n\nCRITICAL — CAROUSEL CONSISTENCY: This is page ${pageIndex + 1} of ${totalPages}.${pageIndex === 0 ? " This is the FIRST page — establish the visual style that all subsequent pages must follow." : ` Match the style of page 1 exactly.`}
EVERY page MUST have IDENTICAL:
- Background: same color, gradient, texture, pattern on ALL pages
- School branding: same school name, affiliations, and contact information placement on every page
- Typography: same font family, same sizes, same colors, same positioning rules
- Borders/frames: same treatment on all pages
- Decorative elements: same style on all pages
Only the hero content (photos, headline text) changes between pages.`
    : "";

  // Build branding instructions from source images instead of rigid copy instructions
  const brandingInstructions = [
    hasLogo ? `Logo: reproduce the SCHOOL LOGO accurately → ${brief.logoPlacement.position}, ${brief.logoPlacement.size}` : "",
    hasHeader ? `School branding: extract school name${brandingPlacement?.affiliations ? ", affiliations" : ""} from the BRANDING SOURCE image and integrate naturally. ${brandingPlacement?.schoolName ?? brief.headerFooter.headerStyle}` : "",
    hasFooter ? `Contact info: extract contact details (phone, website, address) from the CONTACT SOURCE image and place them cleanly. ${brandingPlacement?.contactInfo ?? brief.headerFooter.footerStyle}` : "",
  ].filter(Boolean).join("\n");

  return `Instagram poster for ${schoolName}. Portrait 1080x1350px, print-ready, professional.

## Creative Vision
${visionSection}
${pageDesignPrompt ? `\n## Page Design Brief\n${pageDesignPrompt}` : ""}

## Technical Details
Direction: ${brief.direction}
Theme: ${brief.theme}
Palette: ${brief.colorPalette.join(", ")}
${isCarousel ? `Page ${pageIndex + 1} of ${totalPages} carousel` : ""}
${!isCarousel || pageIndex === 0 ? `Headline: "${brief.textContent.headline}"` : ""}
${!isCarousel && brief.textContent.subheadline ? `Tagline: "${brief.textContent.subheadline}"` : ""}

${brandingInstructions}

${photoSection}
${carouselNote}

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
  costTracker?: CostTracker,
): Promise<{ base64: string; refinedPrompt: string }> {
  const openai = await getModelClient();

  // Refine the prompt
  const refined = await withRateLimitRetry(() =>
    openai.chat.completions.create({
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
    }),
  );

  costTracker?.addLLMCall("refiner_prompt", "gpt-4o-mini", refined.usage);

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
    await addRefAsset(selectedAssets.logo, "SCHOOL LOGO — Reproduce accurately", "logo");
    await addRefAsset(selectedAssets.header, "SCHOOL BRANDING SOURCE — Extract school name, affiliation, and branding text", "header");
    await addRefAsset(selectedAssets.footer, "SCHOOL CONTACT SOURCE — Extract contact details (phone, website, address)", "footer");
    await addRefAsset(selectedAssets.uniform, "UNIFORM REFERENCE", "uniform");
    await addRefAsset(selectedAssets.infrastructure, "INFRASTRUCTURE REFERENCE", "infrastructure");
    for (const sp of selectedAssets.samples ?? []) await addRefAsset(sp, "STYLE REFERENCE POSTER", "sample");
  } else {
    for (const type of ["logo", "header", "footer"] as const) {
      const a = input.brandAssets.find((x) => x.assetType === type);
      if (a) await addRefAsset(a.storagePath, `SCHOOL ${type.toUpperCase()}`, type);
    }
  }

  // Uploaded photos — collect from both brief-level and page-level selections
  const refineSelectedPaths = new Set<string>();
  for (const img of brief.selectedImages ?? []) {
    if (img?.path) refineSelectedPaths.add(img.path);
  }
  if (brief.layout?.pages) {
    for (const p of brief.layout.pages) {
      for (const img of p.selectedImages ?? []) {
        if (img?.path) refineSelectedPaths.add(img.path);
      }
    }
  }
  const refineUseAll = input.curatedImages.length > 0 && refineSelectedPaths.size === 0;
  if (refineUseAll) {
    console.warn(`[Agent3] Refine: Agent 2 assigned 0 paths — using all ${input.curatedImages.length} curated`);
  }
  if (input.curatedImages.length > 0 && (refineSelectedPaths.size > 0 || refineUseAll)) {
    for (const img of input.curatedImages) {
      const fn = img.path.split("/").pop() ?? "";
      const isSelected = refineUseAll || refineSelectedPaths.has(img.path) || [...refineSelectedPaths].some((p) => img.path.endsWith(p) || p.endsWith(fn));
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
  costTracker?.addImageCall("refiner_image", 1, imageSize);
  return { base64, refinedPrompt };
}
