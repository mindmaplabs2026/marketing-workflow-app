import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnderstandingAgent } from "@/lib/ai/agent-understanding";
import { runCreativeAgent } from "@/lib/ai/agent-creative";
import { runGenerationAgent } from "@/lib/ai/agent-generation";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type { UploadedImage } from "@/lib/ai/agent-understanding";
import type { UnderstandingOutput } from "@/lib/ai/agent-understanding";
import type { VariationBrief } from "@/lib/ai/agent-creative";

/**
 * The pipeline is split into chained Inngest functions to avoid the step
 * output size limit. Each function fires an event to trigger the next,
 * so no memoized state accumulates across the full pipeline.
 */

type BrandAsset = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
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
    .select("name")
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

// ---------------------------------------------------------------
// Function 1: Understanding + Creative (single function, 2 steps)
// Fires ai/pipeline.generate when done.
// ---------------------------------------------------------------
export const aiPipelineAnalyze = inngest.createFunction(
  {
    id: "ai-poster-analyze",
    retries: 1,
    triggers: [{ event: "ai/pipeline.started" }],
    onFailure: async ({ event }: { event: { data: { event: { data: { jobId: string } }; error: { message?: string } } } }) => {
      await markFailed(event.data.event.data.jobId, event.data.error.message ?? "Analysis failed");
    },
  },
  async ({ event, step }: { event: { data: { jobId: string; requestId: string; posterType: "single" | "carousel" } }; step: { run: (name: string, fn: () => Promise<void>) => Promise<void>; sendEvent: (name: string, event: { name: string; data: Record<string, string> }) => Promise<void> } }) => {
    const { jobId, requestId, posterType } = event.data;

    // Step 1: Agent 1 — Understanding
    await step.run("agent-understanding", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "understanding", started_at: new Date().toISOString() })
        .eq("id", jobId);

      const ctx = await fetchContext(requestId);
      const result = await runUnderstandingAgent({
        title: ctx.title,
        description: ctx.description,
        images: ctx.images,
        brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      });

      await admin
        .from("ai_generation_jobs")
        .update({
          status: "creative",
          agent1_output: result as unknown as Record<string, unknown>,
        })
        .eq("id", jobId);
    });

    // Step 2: Agent 2 — Creative
    await step.run("agent-creative", async () => {
      const admin = createAdminClient();
      const { data: job } = await admin
        .from("ai_generation_jobs")
        .select("agent1_output")
        .eq("id", jobId)
        .single();
      if (!job?.agent1_output) throw new Error("Agent 1 output not found");

      const understanding = job.agent1_output as unknown as UnderstandingOutput;
      const ctx = await fetchContext(requestId);

      const result = await runCreativeAgent({
        understanding,
        brandAssets: ctx.brandAssets,
        posterType,
        schoolName: ctx.schoolName,
      });

      await admin
        .from("ai_generation_jobs")
        .update({
          status: "generating",
          agent2_output: result as unknown as Record<string, unknown>,
        })
        .eq("id", jobId);
    });

    // Chain to generation function
    await step.sendEvent("trigger-generate", {
      name: "ai/pipeline.generate",
      data: { jobId, requestId, posterType },
    });
  },
);

// ---------------------------------------------------------------
// Function 2: Generate 3 variations + finalize
// Triggered by ai/pipeline.generate — fresh state, no carryover.
// ---------------------------------------------------------------
export const aiPipelineGenerate = inngest.createFunction(
  {
    id: "ai-poster-generate",
    retries: 1,
    triggers: [{ event: "ai/pipeline.generate" }],
    onFailure: async ({ event }: { event: { data: { event: { data: { jobId: string } }; error: { message?: string } } } }) => {
      await markFailed(event.data.event.data.jobId, event.data.error.message ?? "Generation failed");
    },
  },
  async ({ event, step }: { event: { data: { jobId: string; requestId: string; posterType: "single" | "carousel" } }; step: { run: (name: string, fn: () => Promise<void>) => Promise<void> } }) => {
    const { jobId, requestId, posterType } = event.data;

    const generateVariation = async (variationIndex: number): Promise<void> => {
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
        creative_brief: brief as unknown as Record<string, unknown>,
        storage_paths: storagePaths,
        poster_type: posterType,
      });
    };

    await step.run("agent-generate-v1", () => generateVariation(0));
    await step.run("agent-generate-v2", () => generateVariation(1));
    await step.run("agent-generate-v3", () => generateVariation(2));

    await step.run("finalize", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      await dispatchPendingPushes();
    });
  },
);
