/**
 * Runtime-agnostic poster pipeline (Codex Poster Bridge — Phase 2).
 *
 * The live app runs the 5 agents as 5 chained Inngest functions on Vercel
 * (see src/lib/inngest/functions/ai-pipeline.ts). That split exists ONLY to
 * dodge Inngest step limits + Vercel timeouts. On our own always-on server
 * there is no timeout, so the worker can run the whole thing in ONE sequential
 * pass.
 *
 * This module reuses the working, complex helpers from ai-pipeline.ts
 * (fetchContext / generateOneVariation / appendCosts / markFailed) so the
 * intricate carousel/asset logic stays single-sourced, and re-expresses only
 * the evaluate/refine decision flow (which is event-driven in Inngest) as plain
 * sequential calls.
 *
 * The model backend (OpenAI vs Codex) is chosen by MODEL_ENGINE inside the
 * agents, via model-client.ts — this file is agnostic to it.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import { CostTracker } from "./cost-tracker";
import { runUnderstandingAgent } from "./agent-understanding";
import { runCreativeAgent } from "./agent-creative";
import { evaluatePoster, refineAndRegenerate } from "./agent-generation";
import type { UnderstandingOutput, UploadedImage } from "./agent-understanding";
import type { VariationBrief } from "./agent-creative";
import {
  fetchContext,
  appendCosts,
  markFailed,
  generateOneVariation,
} from "@/lib/inngest/functions/ai-pipeline";

type PosterType = "single" | "carousel";

type Worst = { score: number; feedback: string; pageIndex: number };

/**
 * Evaluate the latest variation's pages (re-implements aiPipelineEvaluate
 * without sending events). Writes the _evaluation block + costs, and returns
 * whether the caller should finalize or refine the worst page.
 */
async function evaluateLatestVariation(
  jobId: string,
  requestId: string,
  refinementRound: number,
): Promise<{ finalize: boolean; worst: Worst }> {
  const admin = createAdminClient();
  const costTracker = new CostTracker();
  const defaultWorst: Worst = { score: 10, feedback: "", pageIndex: 0 };

  const { data: variation } = await admin
    .from("ai_variations")
    .select("id, storage_paths, creative_brief")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!variation || variation.storage_paths.length === 0) {
    return { finalize: true, worst: defaultWorst };
  }

  const brief = variation.creative_brief as unknown as VariationBrief;
  const ctx = await fetchContext(requestId);

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
    await addEvalRef(selectedAssets.header, "SCHOOL HEADER — verify this is reproduced");
    await addEvalRef(selectedAssets.footer, "SCHOOL FOOTER — verify this is reproduced");
    if (selectedAssets.samples?.[0]) {
      await addEvalRef(selectedAssets.samples[0], "STYLE REFERENCE — poster should match this quality level");
    }
  }

  if (brief.selectedImages.length > 0) {
    for (const img of brief.selectedImages.slice(0, 3)) {
      const upload = ctx.images.find((u: UploadedImage) =>
        u.path === img.path || u.path.endsWith(img.path) || img.path.endsWith(u.path.split("/").pop() ?? "")
      );
      if (upload?.signedUrl) {
        try {
          const res = await fetch(upload.signedUrl);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            evalReferences.push({ role: "UPLOADED PHOTO — verify this appears as-is in the poster", base64: buf.toString("base64") });
          }
        } catch { /* skip */ }
      }
    }
  }

  let worst: Worst = { score: 10, feedback: "", pageIndex: 0 };
  const pageEvaluations: { pageIndex: number; score: number; feedback: string; passed: boolean }[] = [];

  for (let pi = 0; pi < variation.storage_paths.length; pi++) {
    const pagePath = variation.storage_paths[pi];
    const { data: pageImageData } = await admin.storage.from("designs").download(pagePath);
    if (!pageImageData) continue;

    const pageBase64 = Buffer.from(await pageImageData.arrayBuffer()).toString("base64");
    const isCarousel = variation.storage_paths.length > 1;
    const pageLabel = isCarousel ? ` (page ${pi + 1} of ${variation.storage_paths.length})` : "";

    const evaluation = await evaluatePoster(pageBase64, brief, ctx.schoolName + pageLabel, evalReferences, costTracker);
    pageEvaluations.push({ pageIndex: pi, score: evaluation.score, feedback: evaluation.feedback, passed: evaluation.passesThreshold });

    if (evaluation.score < worst.score) {
      worst = { score: evaluation.score, feedback: evaluation.feedback, pageIndex: pi };
    }
  }

  if (pageEvaluations.length === 0) {
    return { finalize: true, worst: defaultWorst };
  }

  const allPassed = pageEvaluations.every((e) => e.passed);
  const avgScore = Math.round(pageEvaluations.reduce((s, e) => s + e.score, 0) / pageEvaluations.length * 10) / 10;
  console.log(`[Worker] Job ${jobId} | Evaluation round ${refinementRound + 1}: avg=${avgScore}, allPassed=${allPassed}`);

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

  await appendCosts(jobId, costTracker.toJSON());

  return { finalize: allPassed || refinementRound >= 1, worst };
}

/**
 * Refine the worst-scoring page (re-implements aiPipelineRefine without events).
 */
async function refineLatestVariation(
  jobId: string,
  requestId: string,
  worst: Worst,
  refinementRound: number,
): Promise<void> {
  const admin = createAdminClient();
  const costTracker = new CostTracker();

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

  const prompts = brief._generation_log?.prompts ?? [];
  const originalPrompt = prompts[worst.pageIndex] ?? prompts[0] ?? brief.designPrompt;

  const { data: job } = await admin
    .from("ai_generation_jobs")
    .select("agent1_output")
    .eq("id", jobId)
    .single();
  const understanding = job?.agent1_output as unknown as UnderstandingOutput;
  const ctx = await fetchContext(requestId);

  const curatedImages = [];
  for (const img of brief.selectedImages) {
    const match = ctx.images.find((i: UploadedImage) => i.path === img.path);
    if (match) curatedImages.push({ path: match.path, signedUrl: match.signedUrl });
  }

  const result = await refineAndRegenerate(originalPrompt, worst.feedback, worst.score, {
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

  const timestamp = Date.now();
  const storagePath = `${ctx.schoolId}/${requestId}/ai/${brief.variationIndex}/refined-${worst.pageIndex + 1}-${timestamp}.png`;
  const imageBuffer = Buffer.from(result.base64, "base64");

  await admin.storage
    .from("designs")
    .upload(storagePath, imageBuffer, { contentType: "image/png", upsert: false });

  const updatedPaths = [...variation.storage_paths];
  updatedPaths[worst.pageIndex] = storagePath;

  await admin
    .from("ai_variations")
    .update({
      storage_paths: updatedPaths,
      creative_brief: {
        ...brief,
        _generation_log: {
          ...brief._generation_log,
          refinedPrompt: result.refinedPrompt,
          refinedPageIndex: worst.pageIndex,
          refinementRound,
        },
      } as unknown as Record<string, unknown>,
    })
    .eq("id", variation.id);

  await appendCosts(jobId, costTracker.toJSON());
}

/**
 * Run the entire poster pipeline for one job, start to finish, in sequence.
 * Mirrors the Inngest chain: understand → creative → generate → evaluate → (refine?) → complete.
 */
export async function runPosterPipeline(
  jobId: string,
  requestId: string,
  posterType: PosterType,
): Promise<void> {
  const admin = createAdminClient();
  console.log(`[Worker] Job ${jobId} | START (request ${requestId}, ${posterType})`);

  try {
    // --- Agent 1: Understanding ---
    await admin
      .from("ai_generation_jobs")
      .update({ status: "understanding", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const ctx = await fetchContext(requestId);
    const a1Costs = new CostTracker();
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: ctx.images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      schoolGuidelines: ctx.schoolGuidelines,
    }, a1Costs);
    await appendCosts(jobId, a1Costs.toJSON());

    await admin
      .from("ai_generation_jobs")
      .update({ status: "creative", agent1_output: understanding as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 2: Creative direction ---
    const a2Costs = new CostTracker();
    const creative = await runCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets,
      posterType,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
    }, a2Costs);
    await appendCosts(jobId, a2Costs.toJSON());

    await admin
      .from("ai_generation_jobs")
      .update({ status: "generating", agent2_output: creative as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 3: Generation (variation 0, same as the live pipeline) ---
    const a3Costs = new CostTracker();
    await generateOneVariation(jobId, requestId, posterType, 0, a3Costs);
    await appendCosts(jobId, a3Costs.toJSON());

    // --- Agents 4 & 5: Evaluate, then refine the worst page at most once ---
    // Resilience: the poster is already generated. A failure in evaluate/refine
    // must NOT throw the poster away — finalize with what we have. This mirrors
    // the live Inngest pipeline, whose evaluate/refine onFailure handlers mark
    // the job 'completed' rather than 'failed'.
    let round = 0;
    while (round <= 1) {
      let decision: { finalize: boolean; worst: Worst };
      try {
        decision = await evaluateLatestVariation(jobId, requestId, round);
      } catch (err) {
        console.warn(`[Worker] Job ${jobId} | evaluate failed (${err instanceof Error ? err.message : err}) — finalizing with current poster`);
        break;
      }
      if (decision.finalize) break;
      try {
        await refineLatestVariation(jobId, requestId, decision.worst, round + 1);
      } catch (err) {
        console.warn(`[Worker] Job ${jobId} | refine failed (${err instanceof Error ? err.message : err}) — finalizing with current poster`);
        break;
      }
      round += 1;
    }

    // --- Finalize ---
    await admin
      .from("ai_generation_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    try { await dispatchPendingPushes(); } catch { /* best effort */ }

    console.log(`[Worker] Job ${jobId} | COMPLETED`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Worker] Job ${jobId} | FAILED: ${message}`);
    await markFailed(jobId, message);
  }
}
