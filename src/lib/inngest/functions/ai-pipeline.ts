import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnderstandingAgent } from "@/lib/ai/agent-understanding";
import { runCreativeAgent } from "@/lib/ai/agent-creative";
import { runGenerationAgent, evaluatePoster, refineAndRegenerate, QUALITY_THRESHOLD } from "@/lib/ai/agent-generation";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import { CostTracker } from "@/lib/ai/cost-tracker";
import type { CostTracking } from "@/lib/ai/cost-tracker";
import type { UploadedImage } from "@/lib/ai/agent-understanding";
import type { UnderstandingOutput } from "@/lib/ai/agent-understanding";
import type { VariationBrief } from "@/lib/ai/agent-creative";

/**
 * Pipeline split into 5 chained functions to avoid:
 * 1. Inngest step output size limits (no memoized state between steps)
 * 2. Vercel function timeout (each function is one focused task)
 *
 * Chain: started → analyze-done → generate-v1-done → generate-v2-done → generate-v3-done (finalize)
 */

type BrandAsset = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
};

type PipelineData = {
  jobId: string;
  requestId: string;
  posterType: "single" | "carousel";
};

export async function fetchContext(requestId: string, opts?: { includeVideos?: boolean }) {
  const admin = createAdminClient();

  const { data: request, error: reqErr } = await admin
    .from("requests")
    .select("id, school_id, title, description")
    .eq("id", requestId)
    .single();
  if (reqErr || !request) throw new Error("Request not found");

  const { data: school } = await admin
    .from("schools")
    .select("name, ai_guidelines")
    .eq("id", request.school_id)
    .single();

  const { data: uploads } = await admin
    .from("request_uploads")
    .select("storage_path, mime_type, file_size")
    .eq("request_id", requestId);

  const images: UploadedImage[] = [];
  for (const u of uploads ?? []) {
    const isImage = !u.mime_type || u.mime_type.startsWith("image/");
    const isVideo = u.mime_type?.startsWith("video/");
    // Include images always; include videos only when opts.includeVideos is set
    if (!isImage && !(isVideo && opts?.includeVideos)) continue;
    const { data: signedData } = await admin.storage
      .from("request-uploads")
      .createSignedUrl(u.storage_path, 3600);
    if (signedData?.signedUrl) {
      images.push({
        path: u.storage_path,
        signedUrl: signedData.signedUrl,
        mimeType: u.mime_type,
        fileSize: u.file_size,
      });
    }
  }

  const { data: brandAssets } = await admin
    .from("school_brand_assets")
    .select("asset_type, storage_path, label")
    .eq("school_id", request.school_id);

  const brandAssetsWithUrls: BrandAsset[] = [];
  for (const asset of brandAssets ?? []) {
    const { data: signedData } = await admin.storage
      .from("school-assets")
      .createSignedUrl(asset.storage_path, 3600);
    brandAssetsWithUrls.push({
      assetType: asset.asset_type,
      storagePath: asset.storage_path,
      signedUrl: signedData?.signedUrl ?? "",
      label: asset.label,
    });
  }

  return {
    title: request.title,
    description: request.description,
    schoolId: request.school_id,
    schoolName: school?.name ?? "School",
    schoolGuidelines: school?.ai_guidelines ?? null,
    images,
    brandAssets: brandAssetsWithUrls,
  };
}

export async function appendCosts(jobId: string, newCosts: CostTracking) {
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("ai_generation_jobs")
      .select("cost_tracking")
      .eq("id", jobId)
      .single();

    // cost_tracking defaults to '{}' in the DB (migration 0022), so guard for a
    // missing/!array entries field — otherwise the spread throws "not iterable".
    const raw = job?.cost_tracking as Partial<CostTracking> | null | undefined;
    const existing: CostTracking =
      raw && Array.isArray(raw.entries)
        ? (raw as CostTracking)
        : { entries: [], total_usd: 0 };
    const merged: CostTracking = {
      entries: [...existing.entries, ...newCosts.entries],
      total_usd: Math.round((existing.total_usd + newCosts.total_usd) * 1_000_000) / 1_000_000,
    };

    await admin
      .from("ai_generation_jobs")
      .update({ cost_tracking: merged as unknown as Record<string, unknown> })
      .eq("id", jobId);

    console.log(`[Pipeline] Job ${jobId} | Costs: +$${newCosts.total_usd.toFixed(4)} → total $${merged.total_usd.toFixed(4)}`);
  } catch (err) {
    // Don't let cost tracking failures crash the pipeline
    console.warn(`[Pipeline] Job ${jobId} | Cost tracking failed:`, err instanceof Error ? err.message : err);
  }
}

export async function markFailed(jobId: string, message: string) {
  const admin = createAdminClient();
  await admin
    .from("ai_generation_jobs")
    .update({ status: "failed", error_message: message })
    .eq("id", jobId);
  try { await dispatchPendingPushes(); } catch { /* best effort */ }
}

export async function generateOneVariation(jobId: string, requestId: string, posterType: "single" | "carousel", variationIndex: number, costTracker?: CostTracker) {
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("ai_generation_jobs")
    .select("agent1_output, agent2_output")
    .eq("id", jobId)
    .single();
  if (!job?.agent1_output || !job?.agent2_output) {
    throw new Error("Agent outputs not found in DB");
  }

  const understanding = job.agent1_output as unknown as UnderstandingOutput;
  const creative = job.agent2_output as unknown as { variations: VariationBrief[] };
  const brief = creative.variations[variationIndex];
  if (!brief) throw new Error(`Variation ${variationIndex} not found`);

  const ctx = await fetchContext(requestId);

  // Collect selected images — for carousel, Agent 2 assigns photos at page level,
  // not brief level. We need to gather from both to build the full set.
  const imagePaths = new Set<string>();
  for (const img of brief.selectedImages ?? []) {
    if (img?.path) imagePaths.add(img.path);
  }
  // Also collect from page-level selections (carousel)
  if (brief.layout?.pages) {
    for (const page of brief.layout.pages) {
      for (const img of page.selectedImages ?? []) {
        if (img?.path) imagePaths.add(img.path);
      }
    }
  }

  const curatedImages = [];
  const unmatchedPaths: string[] = [];
  for (const imagePath of imagePaths) {
    // Match by exact path or by filename (Agent 2 may use truncated paths)
    const imageFilename = imagePath.split("/").pop() ?? "";
    const match = ctx.images.find((i: UploadedImage) =>
      i.path === imagePath ||
      i.path.endsWith(imagePath) ||
      imagePath.endsWith(i.path.split("/").pop() ?? "___") ||
      i.path.split("/").pop() === imageFilename
    );
    if (match) {
      curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
    } else {
      unmatchedPaths.push(imagePath);
    }
  }

  console.log(`[Pipeline] Job ${jobId} | GenerateV${variationIndex + 1}: ${imagePaths.size} selected paths → ${curatedImages.length} matched, ${unmatchedPaths.length} unmatched`);
  if (unmatchedPaths.length > 0) {
    console.warn(`[Pipeline] Job ${jobId} | UNMATCHED photo paths: ${unmatchedPaths.join(", ")}`);
    console.warn(`[Pipeline] Job ${jobId} | Available upload paths: ${ctx.images.map((i) => i.path).join(", ")}`);
  }

  // --- Carousel photo validation + correction ---
  // Agent 2 should handle photo distribution correctly, but if it fails
  // the rules (cover >1 photo, middle page <3 photos, closing >1 photo),
  // we correct it here as a safety net.
  if (posterType === "carousel" && brief.layout?.pages) {
    const pageCount = brief.layout.pages.length;

    // Build pool of all available curated images (for filling gaps)
    const allCuratedPaths = understanding.curatedImages
      .map((c) => c.path)
      .filter((path): path is string => {
        if (!path) return false;
        const fn = path.split("/").pop() ?? "";
        return ctx.images.some((i) =>
          i.path === path || i.path.endsWith(path) || i.path.split("/").pop() === fn
        );
      });

    // --- Step 1: Remove duplicate photos across pages ---
    const seenPaths = new Set<string>();
    const seenFilenames = new Set<string>();
    let dupsRemoved = 0;
    for (const page of brief.layout.pages) {
      if (!page.selectedImages) continue;
      const deduped = page.selectedImages.filter((img) => {
        if (!img?.path) return false;
        const filename = img.path.split("/").pop() ?? img.path;
        if (seenPaths.has(img.path) || seenFilenames.has(filename)) {
          dupsRemoved++;
          return false;
        }
        seenPaths.add(img.path);
        seenFilenames.add(filename);
        return true;
      });
      if (deduped.length !== page.selectedImages.length) {
        page.selectedImages = deduped;
      }
    }
    if (dupsRemoved > 0) {
      console.log(`[Pipeline] Job ${jobId} | CORRECTION: Removed ${dupsRemoved} duplicate photo(s) across pages`);
    }

    // --- Step 2: Enforce page-level photo limits ---
    const assignedPaths = new Set<string>(seenPaths);
    const unassignedPool = allCuratedPaths.filter((p) => !assignedPaths.has(p));
    let correctionsMade = dupsRemoved > 0;

    for (let pi = 0; pi < pageCount; pi++) {
      const page = brief.layout.pages[pi];
      const photoCount = page.selectedImages?.length ?? 0;
      const isFirst = pi === 0;
      const isLast = pi === pageCount - 1;
      const isMiddle = !isFirst && !isLast;

      if (isFirst && photoCount > 1) {
        // Cover has too many — trim to 1
        page.selectedImages = page.selectedImages.slice(0, 1);
        console.log(`[Pipeline] Job ${jobId} | CORRECTION: Page ${pi + 1} (cover) trimmed from ${photoCount} to 1 photo`);
        correctionsMade = true;
      } else if (isLast && photoCount > 1) {
        // Closing has too many — trim to 1
        page.selectedImages = page.selectedImages.slice(0, 1);
        console.log(`[Pipeline] Job ${jobId} | CORRECTION: Page ${pi + 1} (closing) trimmed from ${photoCount} to 1 photo`);
        correctionsMade = true;
      } else if (isMiddle && photoCount < 3) {
        // Middle page has too few — fill from unassigned pool
        const needed = 3 - photoCount;
        const toAdd = unassignedPool.splice(0, needed);
        if (!page.selectedImages) page.selectedImages = [];
        for (const path of toAdd) {
          page.selectedImages.push({
            path,
            placement: `collage position ${page.selectedImages.length + 1}`,
            size: "medium",
          });
          assignedPaths.add(path);
        }
        console.log(`[Pipeline] Job ${jobId} | CORRECTION: Page ${pi + 1} (middle) filled from ${photoCount} to ${page.selectedImages.length} photos (+${toAdd.length} from pool)`);
        correctionsMade = true;
      } else if (isMiddle && photoCount > 6) {
        // Middle page has too many — trim to 6
        page.selectedImages = page.selectedImages.slice(0, 6);
        console.log(`[Pipeline] Job ${jobId} | CORRECTION: Page ${pi + 1} (middle) trimmed from ${photoCount} to 6 photos`);
        correctionsMade = true;
      }
    }

    if (correctionsMade) {
      // Rebuild curatedImages from the corrected pages
      curatedImages.length = 0;
      const correctedPaths = new Set<string>();
      for (const page of brief.layout.pages) {
        for (const img of page.selectedImages ?? []) {
          if (img?.path) correctedPaths.add(img.path);
        }
      }
      for (const imgPath of correctedPaths) {
        const fn = imgPath.split("/").pop() ?? "";
        const match = ctx.images.find((i: UploadedImage) =>
          i.path === imgPath || i.path.endsWith(imgPath) || i.path.split("/").pop() === fn
        );
        if (match) {
          curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
        }
      }
    }

    // Log final distribution
    for (const page of brief.layout.pages) {
      const role = page.pageIndex === 1 ? "cover" : page.pageIndex === pageCount ? "closing" : "middle";
      console.log(`[Pipeline] Job ${jobId} | Page ${page.pageIndex} (${role}): ${page.selectedImages?.length ?? 0} photos`);
    }
    console.log(`[Pipeline] Job ${jobId} | Photos: ${curatedImages.length} assigned, ${unassignedPool.length} unused from ${allCuratedPaths.length} curated`);
  }

  const result = await runGenerationAgent({
    brief,
    understanding,
    brandAssets: ctx.brandAssets.map((a) => ({
      assetType: a.assetType,
      storagePath: a.storagePath,
      signedUrl: a.signedUrl,
      label: a.label,
    })),
    curatedImages,
    schoolName: ctx.schoolName,
  }, costTracker);

  const storagePaths: string[] = [];
  for (let i = 0; i < result.imageUrls.length; i++) {
    const imageUrl = result.imageUrls[i];
    const timestamp = Date.now();
    const storagePath = `${ctx.schoolId}/${requestId}/ai/${brief.variationIndex}/${timestamp}-page${i + 1}.png`;

    let imageBuffer: Buffer;
    if (imageUrl.startsWith("data:")) {
      const base64 = imageUrl.split(",")[1];
      imageBuffer = Buffer.from(base64, "base64");
    } else {
      const res = await fetch(imageUrl);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    }

    await admin.storage
      .from("designs")
      .upload(storagePath, imageBuffer, {
        contentType: "image/png",
        upsert: false,
      });

    storagePaths.push(storagePath);
  }

  await admin.from("ai_variations").insert({
    job_id: jobId,
    request_id: requestId,
    variation_index: brief.variationIndex,
    creative_brief: {
      ...brief,
      _generation_log: {
        prompts: result.prompts,
        referenceImageCount: result.referenceImageCount,
        refinementRounds: result.refinementRounds,
        model: result.model,
        generatedAt: new Date().toISOString(),
      },
    } as unknown as Record<string, unknown>,
    storage_paths: storagePaths,
    poster_type: posterType,
  });
}

type FailureEvent = { data: { event: { data: PipelineData }; error: { message?: string } } };

// ---------------------------------------------------------------
// Function 1: Understanding + Creative
// ---------------------------------------------------------------
export const aiPipelineAnalyze = inngest.createFunction(
  {
    id: "ai-poster-understand",
    retries: 1,
    triggers: [{ event: "ai/pipeline.started" }],
    onFailure: async ({ event }: { event: FailureEvent }) => {
      await markFailed(event.data.event.data.jobId, event.data.error.message ?? "Understanding failed");
    },
  },
  async ({ event }: { event: { data: PipelineData } }) => {
    const { jobId, requestId, posterType } = event.data;
    const admin = createAdminClient();

    // Mark started
    await admin
      .from("ai_generation_jobs")
      .update({ status: "understanding", started_at: new Date().toISOString() })
      .eq("id", jobId);

    // Agent 1: Understanding
    const ctx = await fetchContext(requestId);
    const brandAssetsByType = ctx.brandAssets.reduce((acc, a) => { acc[a.assetType] = (acc[a.assetType] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    console.log(`[Pipeline] Job ${jobId} | Agent1 INPUT: ${ctx.images.length} images, ${ctx.brandAssets.length} brand assets (${JSON.stringify(brandAssetsByType)}), title="${ctx.title}", posterType=${posterType}`);

    const costTracker = new CostTracker();
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: ctx.images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      schoolGuidelines: ctx.schoolGuidelines,
    }, costTracker);

    console.log(`[Pipeline] Job ${jobId} | Agent1 OUTPUT: theme="${understanding.theme}", ${understanding.curatedImages.length} curated images, ${understanding.rejectedImages?.length ?? 0} rejected`);
    await appendCosts(jobId, costTracker.toJSON());
    if (understanding.curatedImages.length > 0) {
      console.log(`[Pipeline] Job ${jobId} | Agent1 curated: ${understanding.curatedImages.map((c) => `${c.path.split("/").pop()} (rel:${c.relevanceScore})`).join(", ")}`);
    }

    await admin
      .from("ai_generation_jobs")
      .update({
        status: "creative",
        agent1_output: understanding as unknown as Record<string, unknown>,
      })
      .eq("id", jobId);

    // Chain to creative agent (separate function to avoid timeout)
    await inngest.send({
      name: "ai/pipeline.creative",
      data: { jobId, requestId, posterType },
    });
  },
);

// ---------------------------------------------------------------
// Function 2: Creative direction (Agent 2 with web search)
// ---------------------------------------------------------------
export const aiPipelineCreative = inngest.createFunction(
  {
    id: "ai-poster-creative",
    retries: 1,
    triggers: [{ event: "ai/pipeline.creative" }],
    onFailure: async ({ event }: { event: FailureEvent }) => {
      await markFailed(event.data.event.data.jobId, event.data.error.message ?? "Creative failed");
    },
  },
  async ({ event }: { event: { data: PipelineData } }) => {
    const { jobId, requestId, posterType } = event.data;
    const admin = createAdminClient();

    // Re-read Agent 1 output from DB
    const { data: job } = await admin
      .from("ai_generation_jobs")
      .select("agent1_output")
      .eq("id", jobId)
      .single();
    if (!job?.agent1_output) throw new Error("Agent 1 output not found");

    const understanding = job.agent1_output as unknown as UnderstandingOutput;
    const ctx = await fetchContext(requestId);

    console.log(`[Pipeline] Job ${jobId} | Agent2 INPUT: ${understanding.curatedImages.length} curated images, posterType=${posterType}, school="${ctx.schoolName}"`);

    const costTracker = new CostTracker();
    const creative = await runCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets,
      posterType,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
    }, costTracker);

    // Log Agent 2 output summary
    for (const v of creative.variations) {
      const briefAny = v as Record<string, unknown>;
      const selectedAssets = briefAny.selectedAssets as Record<string, unknown> | undefined;
      const pageCount = v.layout.pages.length;
      const briefImages = v.selectedImages.length;
      const pageImages = v.layout.pages.reduce((sum, p) => sum + (p.selectedImages?.length ?? 0), 0);
      console.log(`[Pipeline] Job ${jobId} | Agent2 OUTPUT v${v.variationIndex}: direction="${v.direction}", ${pageCount} pages, ${briefImages} brief-level photos, ${pageImages} page-level photos`);
      if (selectedAssets) {
        console.log(`[Pipeline] Job ${jobId} | Agent2 assets: logo=${selectedAssets.logo ? "yes" : "null"}, header=${selectedAssets.header ? "yes" : "null"}, footer=${selectedAssets.footer ? "yes" : "null"}, samples=${(selectedAssets.samples as string[] | undefined)?.length ?? 0}`);
      }
      for (const p of v.layout.pages) {
        console.log(`[Pipeline] Job ${jobId} | Agent2 page ${p.pageIndex}: ${p.selectedImages?.length ?? 0} photos, vision=${p.creativeVision ? `${p.creativeVision.length} chars` : "MISSING"}`);
      }
    }

    await appendCosts(jobId, costTracker.toJSON());

    await admin
      .from("ai_generation_jobs")
      .update({
        status: "generating",
        agent2_output: creative as unknown as Record<string, unknown>,
      })
      .eq("id", jobId);

    // Chain to variation 1
    await inngest.send({
      name: "ai/pipeline.generate-v1",
      data: { jobId, requestId, posterType },
    });
  },
);

// ---------------------------------------------------------------
// Function 3: Generate variation 1
// ---------------------------------------------------------------
export const aiPipelineGenerateV1 = inngest.createFunction(
  {
    id: "ai-poster-generate-v1",
    retries: 1,
    triggers: [{ event: "ai/pipeline.generate-v1" }],
    onFailure: async ({ event }: { event: FailureEvent }) => {
      await markFailed(event.data.event.data.jobId, event.data.error.message ?? "Generation v1 failed");
    },
  },
  async ({ event }: { event: { data: PipelineData } }) => {
    const { jobId, requestId, posterType } = event.data;

    // Preemptive pause: Agent 1 + Agent 2 consume most of the 200k TPM
    // quota for gpt-4o-mini. Wait 30s so the rate limit window resets
    // before the prompt enhancer calls in generateOneVariation.
    await new Promise((r) => setTimeout(r, 30_000));

    const costTracker = new CostTracker();
    await generateOneVariation(jobId, requestId, posterType, 0, costTracker);
    await appendCosts(jobId, costTracker.toJSON());

    // Chain to evaluate
    await inngest.send({
      name: "ai/pipeline.evaluate",
      data: { jobId, requestId, posterType, refinementRound: 0 },
    });
  },
);

// ---------------------------------------------------------------
// Function 4: Evaluate the generated poster
// ---------------------------------------------------------------
type EvaluateData = PipelineData & { refinementRound: number };

export const aiPipelineEvaluate = inngest.createFunction(
  {
    id: "ai-poster-evaluate",
    retries: 1,
    triggers: [{ event: "ai/pipeline.evaluate" }],
    onFailure: async ({ event }: { event: { data: { event: { data: EvaluateData }; error: { message?: string } } } }) => {
      // On eval failure, just finalize with what we have
      const { jobId } = event.data.event.data;
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
    },
  },
  async ({ event }: { event: { data: EvaluateData } }) => {
    const { jobId, requestId, posterType, refinementRound } = event.data;
    const admin = createAdminClient();
    const costTracker = new CostTracker();

    // Get the latest variation's storage path
    const { data: variation } = await admin
      .from("ai_variations")
      .select("id, storage_paths, creative_brief")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!variation || variation.storage_paths.length === 0) {
      // No variation to evaluate — just finalize
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
      return;
    }

    const brief = variation.creative_brief as unknown as VariationBrief;
    const ctx = await fetchContext(requestId);

    // Collect reference images for comparison
    const selectedAssets = (brief as Record<string, unknown>).selectedAssets as {
      logo?: string | null; header?: string | null; footer?: string | null;
      samples?: string[];
    } | undefined;

    const evalReferences: { role: string; base64: string }[] = [];

    async function addEvalRef(storagePath: string | null | undefined, role: string): Promise<void> {
      if (!storagePath) return;
      const asset = ctx.brandAssets.find((a) =>
        a.storagePath === storagePath || a.storagePath.endsWith(storagePath) || storagePath.endsWith(a.storagePath.split("/").pop() ?? "")
      );
      if (!asset?.signedUrl) return;
      try {
        const res = await fetch(asset.signedUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          evalReferences.push({ role, base64: buf.toString("base64") });
        }
      } catch { /* skip if download fails */ }
    }

    if (selectedAssets) {
      await addEvalRef(selectedAssets.logo, "SCHOOL LOGO — verify this matches exactly");
      await addEvalRef(selectedAssets.header, "SCHOOL BRANDING SOURCE — verify school name and branding info is present");
      await addEvalRef(selectedAssets.footer, "SCHOOL CONTACT SOURCE — verify contact details are present");
      if (selectedAssets.samples?.[0]) {
        await addEvalRef(selectedAssets.samples[0], "STYLE REFERENCE — poster should match this quality level");
      }
    }

    // Include uploaded photos so evaluator can check they're used as-is
    if (brief.selectedImages.length > 0) {
      for (const img of brief.selectedImages.slice(0, 3)) {
        const upload = ctx.images.find((u) =>
          u.path === img.path || u.path.endsWith(img.path) || img.path.endsWith(u.path.split("/").pop() ?? "")
        );
        if (upload?.signedUrl) {
          try {
            const res = await fetch(upload.signedUrl);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              evalReferences.push({ role: `UPLOADED PHOTO — verify this appears as-is in the poster`, base64: buf.toString("base64") });
            }
          } catch { /* skip */ }
        }
      }
    }

    // Evaluate ALL pages (carousel) or the single poster
    // Track the worst-scoring page for targeted refinement
    let worstScore = 10;
    let worstFeedback = "";
    let worstPageIndex = 0;
    const pageEvaluations: { pageIndex: number; score: number; feedback: string; passed: boolean }[] = [];

    for (let pi = 0; pi < variation.storage_paths.length; pi++) {
      const pagePath = variation.storage_paths[pi];
      const { data: pageImageData } = await admin.storage
        .from("designs")
        .download(pagePath);

      if (!pageImageData) continue;

      const pageBase64 = Buffer.from(await pageImageData.arrayBuffer()).toString("base64");
      const isCarousel = variation.storage_paths.length > 1;
      const pageLabel = isCarousel ? ` (page ${pi + 1} of ${variation.storage_paths.length})` : "";

      const evaluation = await evaluatePoster(pageBase64, brief, ctx.schoolName + pageLabel, evalReferences, costTracker);
      pageEvaluations.push({ pageIndex: pi, score: evaluation.score, feedback: evaluation.feedback, passed: evaluation.passesThreshold });

      if (evaluation.score < worstScore) {
        worstScore = evaluation.score;
        worstFeedback = evaluation.feedback;
        worstPageIndex = pi;
      }
    }

    if (pageEvaluations.length === 0) {
      // Couldn't evaluate any page — finalize
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
      return;
    }

    const allPassed = pageEvaluations.every((e) => e.passed);
    const avgScore = Math.round(pageEvaluations.reduce((s, e) => s + e.score, 0) / pageEvaluations.length * 10) / 10;

    console.log(`[Pipeline] Job ${jobId} | Evaluation round ${refinementRound + 1}: avg=${avgScore}, allPassed=${allPassed}`);
    for (const pe of pageEvaluations) {
      console.log(`[Pipeline] Job ${jobId} | Page ${pe.pageIndex + 1}: score=${pe.score}, passed=${pe.passed}, feedback="${pe.feedback.slice(0, 120)}"`);
    }
    await appendCosts(jobId, costTracker.toJSON());

    // Log evaluation in the variation's creative brief
    await admin
      .from("ai_variations")
      .update({
        creative_brief: {
          ...brief,
          _evaluation: {
            round: refinementRound + 1,
            averageScore: avgScore,
            pages: pageEvaluations,
            passed: allPassed || refinementRound >= 1,
          },
        } as unknown as Record<string, unknown>,
      })
      .eq("id", variation.id);

    if (allPassed || refinementRound >= 1) {
      // Good enough or max refinements reached — finalize
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
    } else {
      // Needs refinement — refine the worst-scoring page
      await inngest.send({
        name: "ai/pipeline.refine",
        data: {
          jobId,
          requestId,
          posterType,
          refinementRound: refinementRound + 1,
          feedback: worstFeedback,
          score: worstScore,
          pageIndex: worstPageIndex,
        },
      });
    }
  },
);

// ---------------------------------------------------------------
// Function 5: Refine and regenerate
// ---------------------------------------------------------------
type RefineData = EvaluateData & { feedback: string; score: number; pageIndex: number };

export const aiPipelineRefine = inngest.createFunction(
  {
    id: "ai-poster-refine",
    retries: 1,
    triggers: [{ event: "ai/pipeline.refine" }],
    onFailure: async ({ event }: { event: { data: { event: { data: RefineData }; error: { message?: string } } } }) => {
      // On refine failure, finalize with existing image
      const { jobId } = event.data.event.data;
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
    },
  },
  async ({ event }: { event: { data: RefineData } }) => {
    const { jobId, requestId, posterType, refinementRound, feedback, score, pageIndex } = event.data;
    const admin = createAdminClient();
    const costTracker = new CostTracker();

    // Get the variation (including storage_paths so we can preserve other pages)
    const { data: variation } = await admin
      .from("ai_variations")
      .select("id, creative_brief, storage_paths")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!variation) throw new Error("Variation not found for refinement");

    const brief = variation.creative_brief as unknown as VariationBrief & {
      _generation_log?: { prompts?: string[] };
    };

    // Use the prompt for the specific page that failed evaluation
    const prompts = brief._generation_log?.prompts ?? [];
    const originalPrompt = prompts[pageIndex] ?? prompts[0] ?? brief.designPrompt;

    // Re-read agent outputs and context
    const { data: job } = await admin
      .from("ai_generation_jobs")
      .select("agent1_output, agent2_output")
      .eq("id", jobId)
      .single();

    const understanding = job?.agent1_output as unknown as UnderstandingOutput;
    const ctx = await fetchContext(requestId);

    const curatedImages = [];
    for (const img of brief.selectedImages) {
      const match = ctx.images.find((i: UploadedImage) => i.path === img.path);
      if (match) {
        curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
      }
    }

    const result = await refineAndRegenerate(originalPrompt, feedback, score, {
      brief,
      understanding,
      brandAssets: ctx.brandAssets.map((a) => ({
        assetType: a.assetType,
        storagePath: a.storagePath,
        signedUrl: a.signedUrl,
        label: a.label,
      })),
      curatedImages,
      schoolName: ctx.schoolName,
    }, costTracker);

    // Upload the refined image
    const timestamp = Date.now();
    const storagePath = `${ctx.schoolId}/${requestId}/ai/${brief.variationIndex}/refined-${pageIndex + 1}-${timestamp}.png`;
    const imageBuffer = Buffer.from(result.base64, "base64");

    await admin.storage
      .from("designs")
      .upload(storagePath, imageBuffer, { contentType: "image/png", upsert: false });

    // Replace ONLY the refined page in storage_paths — preserve other pages
    const updatedPaths = [...variation.storage_paths];
    updatedPaths[pageIndex] = storagePath;

    await admin
      .from("ai_variations")
      .update({
        storage_paths: updatedPaths,
        creative_brief: {
          ...brief,
          _generation_log: {
            ...brief._generation_log,
            refinedPrompt: result.refinedPrompt,
            refinedPageIndex: pageIndex,
            refinementRound,
          },
        } as unknown as Record<string, unknown>,
      })
      .eq("id", variation.id);

    await appendCosts(jobId, costTracker.toJSON());

    // Evaluate the refined version (re-evaluates all pages)
    await inngest.send({
      name: "ai/pipeline.evaluate",
      data: { jobId, requestId, posterType, refinementRound },
    });
  },
);
