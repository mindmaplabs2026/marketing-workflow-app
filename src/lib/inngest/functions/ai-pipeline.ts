import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnderstandingAgent } from "@/lib/ai/agent-understanding";
import { runCreativeAgent } from "@/lib/ai/agent-creative";
import { runGenerationAgent } from "@/lib/ai/agent-generation";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type { UploadedImage } from "@/lib/ai/agent-understanding";
import type { UnderstandingOutput } from "@/lib/ai/agent-understanding";
import type { VariationBrief } from "@/lib/ai/agent-creative";

type PipelineEvent = {
  name: "ai/pipeline.started";
  data: {
    jobId: string;
    requestId: string;
    posterType: "single" | "carousel";
  };
};

type BrandAsset = {
  assetType: string;
  storagePath: string;
  signedUrl: string;
  label: string | null;
};

/**
 * Re-fetches context data (request, uploads, brand assets) from the DB.
 * Called at the start of each step to avoid passing large data between steps
 * (Inngest has a 4MB step output limit).
 */
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

export const aiPipeline = inngest.createFunction(
  {
    id: "ai-poster-pipeline",
    retries: 1,
    triggers: [{ event: "ai/pipeline.started" }],
    onFailure: async ({ event }: { event: { data: { event: { data: { jobId: string } }; error: { message?: string } } } }) => {
      const admin = createAdminClient();
      const jobId = event.data.event.data.jobId;
      await admin
        .from("ai_generation_jobs")
        .update({
          status: "failed",
          error_message: event.data.error.message ?? "Unknown error",
        })
        .eq("id", jobId);
      try {
        await dispatchPendingPushes();
      } catch {
        // best effort
      }
    },
  },
  async ({ event, step }: { event: { data: PipelineEvent["data"] }; step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { jobId, requestId, posterType } = event.data;

    // -----------------------------------------------------------
    // Step 1: Fetch context + mark started
    // Returns only minimal metadata — NOT the full context.
    // -----------------------------------------------------------
    await step.run("fetch-context", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "understanding", started_at: new Date().toISOString() })
        .eq("id", jobId);
      // Verify request exists
      const ctx = await fetchContext(requestId);
      return { imageCount: ctx.images.length, assetCount: ctx.brandAssets.length };
    });

    // -----------------------------------------------------------
    // Step 2: Agent 1 — Understanding
    // Stores output in DB; returns nothing to stay under size limit.
    // -----------------------------------------------------------
    await step.run("agent-understanding", async () => {
      const ctx = await fetchContext(requestId);
      const result = await runUnderstandingAgent({
        title: ctx.title,
        description: ctx.description,
        images: ctx.images,
        brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      });

      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({
          status: "creative",
          agent1_output: result as unknown as Record<string, unknown>,
        })
        .eq("id", jobId);

      // Return only a summary, not the full output
      return { curatedCount: result.curatedImages.length, theme: result.theme };
    });

    // -----------------------------------------------------------
    // Step 3: Agent 2 — Creative directions
    // Stores output in DB; returns only variation count.
    // -----------------------------------------------------------
    await step.run("agent-creative", async () => {
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

      return { variationCount: result.variations.length };
    });

    // -----------------------------------------------------------
    // Steps 4-6: Agent 3 — Generate each variation
    // Each step re-reads everything from DB to stay independent.
    // -----------------------------------------------------------
    const generateVariation = async (variationIndex: number) => {
      const admin = createAdminClient();

      // Re-read agent outputs from DB
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
        const match = ctx.images.find((i) => i.path === img.path);
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

      // Download generated images and upload to Supabase Storage
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

      // Create variation record
      await admin.from("ai_variations").insert({
        job_id: jobId,
        request_id: requestId,
        variation_index: brief.variationIndex,
        creative_brief: brief as unknown as Record<string, unknown>,
        storage_paths: storagePaths,
        poster_type: posterType,
      });

      // Return only the count, not full paths
      return { pages: storagePaths.length };
    };

    await step.run("agent-generate-v1", () => generateVariation(0));
    await step.run("agent-generate-v2", () => generateVariation(1));
    await step.run("agent-generate-v3", () => generateVariation(2));

    // -----------------------------------------------------------
    // Step 7: Finalize
    // -----------------------------------------------------------
    await step.run("finalize", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);

      await dispatchPendingPushes();
      return { done: true };
    });

    return { jobId, status: "completed" };
  },
);
