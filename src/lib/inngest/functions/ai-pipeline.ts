import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnderstandingAgent } from "@/lib/ai/agent-understanding";
import { runCreativeAgent } from "@/lib/ai/agent-creative";
import { runGenerationAgent, evaluatePoster, refineAndRegenerate, QUALITY_THRESHOLD } from "@/lib/ai/agent-generation";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
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

async function fetchContext(requestId: string) {
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

async function markFailed(jobId: string, message: string) {
  const admin = createAdminClient();
  await admin
    .from("ai_generation_jobs")
    .update({ status: "failed", error_message: message })
    .eq("id", jobId);
  try { await dispatchPendingPushes(); } catch { /* best effort */ }
}

async function generateOneVariation(jobId: string, requestId: string, posterType: "single" | "carousel", variationIndex: number) {
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

  const curatedImages = [];
  for (const img of brief.selectedImages) {
    const match = ctx.images.find((i: UploadedImage) => i.path === img.path);
    if (match) {
      curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
    }
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
  });

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
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: ctx.images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
    });

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

    const creative = await runCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets,
      posterType,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
    });

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
    await generateOneVariation(jobId, requestId, posterType, 0);

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

    // Download the generated image to evaluate
    const latestPath = variation.storage_paths[variation.storage_paths.length - 1];
    const { data: imageData } = await admin.storage
      .from("designs")
      .download(latestPath);

    if (!imageData) {
      // Can't evaluate — finalize with what we have
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
      return;
    }

    const imageBase64 = Buffer.from(await imageData.arrayBuffer()).toString("base64");
    const brief = variation.creative_brief as unknown as VariationBrief;

    // Get school name for evaluation context
    const { data: request } = await admin
      .from("requests")
      .select("school_id")
      .eq("id", requestId)
      .single();
    const { data: school } = await admin
      .from("schools")
      .select("name")
      .eq("id", request?.school_id ?? "")
      .single();

    const evaluation = await evaluatePoster(imageBase64, brief, school?.name ?? "School");

    // Log evaluation in the variation's creative brief
    await admin
      .from("ai_variations")
      .update({
        creative_brief: {
          ...brief,
          _evaluation: {
            round: refinementRound + 1,
            score: evaluation.score,
            feedback: evaluation.feedback,
            passed: evaluation.passesThreshold,
          },
        } as unknown as Record<string, unknown>,
      })
      .eq("id", variation.id);

    if (evaluation.passesThreshold || refinementRound >= 1) {
      // Good enough or max refinements reached — finalize
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
    } else {
      // Needs refinement — chain to refine
      await inngest.send({
        name: "ai/pipeline.refine",
        data: {
          jobId,
          requestId,
          posterType,
          refinementRound: refinementRound + 1,
          feedback: evaluation.feedback,
          score: evaluation.score,
        },
      });
    }
  },
);

// ---------------------------------------------------------------
// Function 5: Refine and regenerate
// ---------------------------------------------------------------
type RefineData = EvaluateData & { feedback: string; score: number };

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
    const { jobId, requestId, posterType, refinementRound, feedback, score } = event.data;
    const admin = createAdminClient();

    // Get the original prompt from the variation
    const { data: variation } = await admin
      .from("ai_variations")
      .select("id, creative_brief")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!variation) throw new Error("Variation not found for refinement");

    const brief = variation.creative_brief as unknown as VariationBrief & {
      _generation_log?: { prompts?: string[] };
    };
    const originalPrompt = brief._generation_log?.prompts?.[0] ?? brief.designPrompt;

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
    });

    // Upload the refined image
    const timestamp = Date.now();
    const storagePath = `${ctx.schoolId}/${requestId}/ai/${brief.variationIndex}/refined-${timestamp}.png`;
    const imageBuffer = Buffer.from(result.base64, "base64");

    await admin.storage
      .from("designs")
      .upload(storagePath, imageBuffer, { contentType: "image/png", upsert: false });

    // Update variation with the new image
    await admin
      .from("ai_variations")
      .update({
        storage_paths: [storagePath],
        creative_brief: {
          ...brief,
          _generation_log: {
            ...brief._generation_log,
            refinedPrompt: result.refinedPrompt,
            refinementRound,
          },
        } as unknown as Record<string, unknown>,
      })
      .eq("id", variation.id);

    // Evaluate the refined version
    await inngest.send({
      name: "ai/pipeline.evaluate",
      data: { jobId, requestId, posterType, refinementRound },
    });
  },
);
