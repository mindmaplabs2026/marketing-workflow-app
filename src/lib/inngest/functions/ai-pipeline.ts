import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnderstandingAgent } from "@/lib/ai/agent-understanding";
import { runCreativeAgent } from "@/lib/ai/agent-creative";
import { runGenerationAgent } from "@/lib/ai/agent-generation";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type { UploadedImage } from "@/lib/ai/agent-understanding";
import type { VariationBrief } from "@/lib/ai/agent-creative";

type PipelineEvent = {
  name: "ai/pipeline.started";
  data: {
    jobId: string;
    requestId: string;
    posterType: "single" | "carousel";
  };
};

export const aiPipeline = inngest.createFunction(
  {
    id: "ai-poster-pipeline",
    retries: 1,
    triggers: [{ event: "ai/pipeline.started" }],
    onFailure: async ({ event }: { event: { data: { event: { data: { jobId: string } }; error: { message?: string } } } }) => {
      // Mark job as failed on unrecoverable error
      const admin = createAdminClient();
      const jobId = event.data.event.data.jobId as string;
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
    const { jobId, requestId, posterType } =
      event.data as PipelineEvent["data"];

    // -----------------------------------------------------------
    // Step 1: Fetch context
    // -----------------------------------------------------------
    const context = await step.run("fetch-context", async () => {
      const admin = createAdminClient();

      // Mark job as started
      await admin
        .from("ai_generation_jobs")
        .update({ status: "understanding", started_at: new Date().toISOString() })
        .eq("id", jobId);

      // Fetch request
      const { data: request, error: reqErr } = await admin
        .from("requests")
        .select("id, school_id, title, description")
        .eq("id", requestId)
        .single();
      if (reqErr || !request) throw new Error("Request not found");

      // Fetch school name
      const { data: school } = await admin
        .from("schools")
        .select("name")
        .eq("id", request.school_id)
        .single();

      // Fetch uploads (signed URLs)
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

      // Fetch school brand assets
      const { data: brandAssets } = await admin
        .from("school_brand_assets")
        .select("asset_type, storage_path, label")
        .eq("school_id", request.school_id);

      const brandAssetsWithUrls = [];
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
    });

    // -----------------------------------------------------------
    // Step 2: Agent 1 — Understanding
    // -----------------------------------------------------------
    const understanding = await step.run("agent-understanding", async () => {
      const result = await runUnderstandingAgent({
        title: context.title,
        description: context.description,
        images: context.images,
        brandAssetTypes: context.brandAssets.map((a: { assetType: string; storagePath: string; signedUrl: string; label: string | null }) => a.assetType),
      });

      // Persist output
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({
          status: "creative",
          agent1_output: result as unknown as Record<string, unknown>,
        })
        .eq("id", jobId);

      return result;
    });

    // -----------------------------------------------------------
    // Step 3: Agent 2 — Creative directions
    // -----------------------------------------------------------
    const creative = await step.run("agent-creative", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "creative" })
        .eq("id", jobId);

      const result = await runCreativeAgent({
        understanding,
        brandAssets: context.brandAssets,
        posterType,
        schoolName: context.schoolName,
      });

      await admin
        .from("ai_generation_jobs")
        .update({
          status: "generating",
          agent2_output: result as unknown as Record<string, unknown>,
        })
        .eq("id", jobId);

      return result;
    });

    // -----------------------------------------------------------
    // Steps 4-6: Agent 3 — Generate each variation
    // -----------------------------------------------------------
    const generateVariation = async (brief: VariationBrief) => {
      const curatedImages = [];
      for (const img of brief.selectedImages) {
        const match = context.images.find((i) => i.path === img.path);
        if (match) {
          curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
        }
      }

      const result = await runGenerationAgent({
        brief,
        understanding,
        brandAssets: context.brandAssets.map((a: { assetType: string; storagePath: string; signedUrl: string; label: string | null }) => ({
          assetType: a.assetType,
          storagePath: a.storagePath,
          signedUrl: a.signedUrl,
        })),
        curatedImages,
        schoolName: context.schoolName,
      });

      // Download generated images and upload to Supabase Storage
      const admin = createAdminClient();
      const storagePaths: string[] = [];

      for (let i = 0; i < result.imageUrls.length; i++) {
        const imageUrl = result.imageUrls[i];
        const timestamp = Date.now();
        const storagePath = `${context.schoolId}/${requestId}/ai/${brief.variationIndex}/${timestamp}-page${i + 1}.png`;

        // Fetch the image from OpenAI
        let imageBuffer: Buffer;
        if (imageUrl.startsWith("data:")) {
          // base64 data URL
          const base64 = imageUrl.split(",")[1];
          imageBuffer = Buffer.from(base64, "base64");
        } else {
          // HTTP URL
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

      return storagePaths;
    };

    const v1Paths = await step.run("agent-generate-v1", () =>
      generateVariation(creative.variations[0]),
    );
    const v2Paths = await step.run("agent-generate-v2", () =>
      generateVariation(creative.variations[1]),
    );
    const v3Paths = await step.run("agent-generate-v3", () =>
      generateVariation(creative.variations[2]),
    );

    // -----------------------------------------------------------
    // Step 7: Finalize
    // -----------------------------------------------------------
    await step.run("finalize", async () => {
      const admin = createAdminClient();
      await admin
        .from("ai_generation_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);

      // Dispatch push notifications (the DB trigger creates the notification
      // row when status changes to 'completed')
      await dispatchPendingPushes();
    });

    return {
      jobId,
      variations: [v1Paths, v2Paths, v3Paths],
    };
  },
);
