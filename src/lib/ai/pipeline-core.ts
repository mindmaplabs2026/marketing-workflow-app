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
// Reel-specific imports are dynamic to avoid Turbopack tracing into
// Node-only modules (child_process, @remotion/*) during the Vercel build.
// These modules are only loaded when runReelPipeline() is called by the
// local worker — never on Vercel.
import type { ReelScript } from "./agent-creative-reel";

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
    await addEvalRef(selectedAssets.header, "SCHOOL BRANDING SOURCE — verify school name and branding info is present");
    await addEvalRef(selectedAssets.footer, "SCHOOL CONTACT SOURCE — verify contact details are present");
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
  for (const pe of pageEvaluations) {
    console.log(`[Worker] Job ${jobId} |   Page ${pe.pageIndex + 1}: score=${pe.score}, passed=${pe.passed}, feedback="${pe.feedback.slice(0, 120)}"`);
  }

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
    console.log(`[Worker] Job ${jobId} | ── Agent 1: Understanding ──`);
    await admin
      .from("ai_generation_jobs")
      .update({ status: "understanding", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const ctx = await fetchContext(requestId);
    const brandAssetsByType = ctx.brandAssets.reduce((acc, a) => { acc[a.assetType] = (acc[a.assetType] ?? 0) + 1; return acc; }, {} as Record<string, number>);
    console.log(`[Worker] Job ${jobId} | Agent1 INPUT: ${ctx.images.length} images, ${ctx.brandAssets.length} brand assets (${JSON.stringify(brandAssetsByType)}), title="${ctx.title}"`);

    const a1Costs = new CostTracker();
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: ctx.images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      schoolGuidelines: ctx.schoolGuidelines,
    }, a1Costs);
    await appendCosts(jobId, a1Costs.toJSON());

    console.log(`[Worker] Job ${jobId} | Agent1 OUTPUT: theme="${understanding.theme}", ${understanding.curatedImages.length} curated, ${understanding.rejectedImages?.length ?? 0} rejected`);
    console.log(`[Worker] Job ${jobId} | Agent1 curated: ${understanding.curatedImages.map((c) => `${c.path.split("/").pop()} (rel:${c.relevanceScore})`).join(", ") || "(none)"}`);

    await admin
      .from("ai_generation_jobs")
      .update({ status: "creative", agent1_output: understanding as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 2: Creative direction ---
    console.log(`[Worker] Job ${jobId} | ── Agent 2: Creative Direction ──`);
    console.log(`[Worker] Job ${jobId} | Agent2 INPUT: ${understanding.curatedImages.length} curated images, posterType=${posterType}, school="${ctx.schoolName}"`);

    const a2Costs = new CostTracker();
    const creative = await runCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets,
      posterType,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
    }, a2Costs);
    await appendCosts(jobId, a2Costs.toJSON());

    // Log Agent 2 output in detail
    for (const v of creative.variations) {
      const briefAny = v as Record<string, unknown>;
      const selectedAssets = briefAny.selectedAssets as Record<string, unknown> | undefined;
      const pageCount = v.layout.pages.length;
      const briefImages = (v.selectedImages ?? []).length;
      const pageImages = v.layout.pages.reduce((sum, p) => sum + (p.selectedImages?.length ?? 0), 0);
      console.log(`[Worker] Job ${jobId} | Agent2 OUTPUT v${v.variationIndex}: direction="${v.direction}", ${pageCount} pages, ${briefImages} brief-level photos, ${pageImages} page-level photos`);
      console.log(`[Worker] Job ${jobId} | Agent2 headline: "${v.textContent.headline}"`);
      console.log(`[Worker] Job ${jobId} | Agent2 palette: ${v.colorPalette.join(", ")}`);
      if (selectedAssets) {
        console.log(`[Worker] Job ${jobId} | Agent2 assets: logo=${selectedAssets.logo ? "yes" : "null"}, header=${selectedAssets.header ? "yes" : "null"}, footer=${selectedAssets.footer ? "yes" : "null"}, samples=${(selectedAssets.samples as string[] | undefined)?.length ?? 0}`);
      }
      const vision = (briefAny.creativeVision as string) ?? "";
      if (vision) {
        console.log(`[Worker] Job ${jobId} | Agent2 creativeVision (${vision.length} chars):`);
        const lines = vision.split("\n");
        for (const line of lines) {
          if (line.trim()) console.log(`[Worker] Job ${jobId} |   ${line.trim()}`);
        }
      }
      for (const p of v.layout.pages) {
        const pageVision = p.creativeVision ?? "";
        console.log(`[Worker] Job ${jobId} | Agent2 page ${p.pageIndex}: ${p.selectedImages?.length ?? 0} photos, vision=${pageVision ? `${pageVision.length}ch` : "MISSING"}, desc="${(p.description ?? "").slice(0, 100)}"`);
      }
    }

    await admin
      .from("ai_generation_jobs")
      .update({ status: "generating", agent2_output: creative as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 3: Generation (variation 0, same as the live pipeline) ---
    console.log(`[Worker] Job ${jobId} | ── Agent 3: Image Generation ──`);
    const a3Costs = new CostTracker();
    await generateOneVariation(jobId, requestId, posterType, 0, a3Costs);
    await appendCosts(jobId, a3Costs.toJSON());

    console.log(`[Worker] Job ${jobId} | ── Agent 4: Evaluation ──`);
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
      if (decision.finalize) {
        console.log(`[Worker] Job ${jobId} | Evaluation passed — finalizing`);
        break;
      }
      console.log(`[Worker] Job ${jobId} | ── Agent 5: Refinement (round ${round + 1}) ──`);
      console.log(`[Worker] Job ${jobId} | Worst page: ${decision.worst.pageIndex + 1}, score: ${decision.worst.score}, feedback: "${decision.worst.feedback.slice(0, 150)}"`);
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

// ─────────────────────────────────────────────────────────────────────
// REEL PIPELINE — parallel sibling to the poster pipeline.
// understand → creative reel script → music → composition → render → evaluate
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the entire reel pipeline for one job: AI-generated Remotion composition
 * rendered to MP4. Creates one variation per run (can be extended to 3).
 */
export async function runReelPipeline(
  jobId: string,
  requestId: string,
): Promise<void> {
  // Dynamic imports — these modules use child_process/spawn which Turbopack
  // cannot statically analyze. They only run on the local worker, never Vercel.
  const { runReelCreativeAgent } = await import("./agent-creative-reel");
  const { findAndTrimMusic } = await import("./agent-music");
  const { generateComposition, refineReelComposition } = await import("./agent-composition");
  const { evaluateReel } = await import("./agent-reel-evaluator");
  const { renderReel } = await import("@/lib/remotion/render");

  const admin = createAdminClient();
  console.log(`[Worker] Reel Job ${jobId} | START (request ${requestId})`);

  try {
    // --- Agent 1: Understanding (reused as-is) ---
    console.log(`[Worker] Reel ${jobId} | ── Agent 1: Understanding ──`);
    await admin
      .from("ai_generation_jobs")
      .update({ status: "understanding", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const ctx = await fetchContext(requestId);
    console.log(`[Worker] Reel ${jobId} | ${ctx.images.length} uploads, ${ctx.brandAssets.length} brand assets, title="${ctx.title}"`);

    const a1Costs = new CostTracker();
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: ctx.images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      schoolGuidelines: ctx.schoolGuidelines,
    }, a1Costs);
    await appendCosts(jobId, a1Costs.toJSON());

    console.log(`[Worker] Reel ${jobId} | Agent1: theme="${understanding.theme}", ${understanding.curatedImages.length} curated`);

    await admin
      .from("ai_generation_jobs")
      .update({ status: "creative", agent1_output: understanding as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 2: Reel Script ---
    console.log(`[Worker] Reel ${jobId} | ── Agent 2: Reel Script ──`);
    const { data: jobRow } = await admin
      .from("ai_generation_jobs")
      .select("reel_duration_sec")
      .eq("id", jobId)
      .single();
    const requestedDuration = (jobRow?.reel_duration_sec as number | null) ?? 60;

    const a2Costs = new CostTracker();
    const reelCreative = await runReelCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets.map((a) => ({
        assetType: a.assetType,
        storagePath: a.storagePath,
        signedUrl: a.signedUrl,
        label: a.label,
      })),
      requestedDurationSec: requestedDuration,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
    }, a2Costs);
    await appendCosts(jobId, a2Costs.toJSON());

    await admin
      .from("ai_generation_jobs")
      .update({ status: "music", agent2_output: reelCreative as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // Process each variation (typically 3, but run sequentially to avoid OOM)
    for (const script of reelCreative.variations) {
      console.log(`[Worker] Reel ${jobId} | ── Variation ${script.variationIndex} ──`);

      // --- Music Discovery ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Finding music: [${script.musicMood.join(", ")}] ${script.musicTempo}`);
      const music = await findAndTrimMusic({
        musicMood: script.musicMood,
        musicTempo: script.musicTempo,
        durationSec: script.durationSec,
      });
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Music: ${music.source}, ${(music.buffer.length / 1024).toFixed(0)} KB`);

      // Update status to generating for the first variation
      if (script.variationIndex === 1) {
        await admin
          .from("ai_generation_jobs")
          .update({ status: "generating" })
          .eq("id", jobId);
      }

      // --- Download media from Supabase to local buffers ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Downloading ${script.scenes.length} media files`);
      const mediaFiles = new Map<string, Buffer>();
      const mediaManifest = new Map<string, { type: "image" | "video"; description: string }>();

      for (const scene of script.scenes) {
        const match = ctx.images.find((img: UploadedImage) => img.path === scene.mediaPath);
        if (!match?.signedUrl) {
          console.warn(`[Worker] Reel ${jobId} | Media not found: ${scene.mediaPath}`);
          continue;
        }
        try {
          const res = await fetch(match.signedUrl);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          const filename = scene.mediaPath.split("/").pop() ?? `media-${scene.index}.bin`;
          mediaFiles.set(filename, buf);
          const curatedInfo = understanding.curatedImages.find((c) => c.path === scene.mediaPath);
          mediaManifest.set(filename, {
            type: scene.mediaType,
            description: curatedInfo?.description ?? "uploaded media",
          });
        } catch {
          console.warn(`[Worker] Reel ${jobId} | Failed to download: ${scene.mediaPath}`);
        }
      }

      // Download logo if available
      let hasLogo = false;
      const logoAsset = ctx.brandAssets.find((a) => a.assetType === "logo");
      if (logoAsset?.signedUrl) {
        try {
          const res = await fetch(logoAsset.signedUrl);
          if (res.ok) {
            mediaFiles.set("logo.png", Buffer.from(await res.arrayBuffer()));
            hasLogo = true;
          }
        } catch { /* skip */ }
      }

      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — ${mediaFiles.size} media files downloaded, logo=${hasLogo}`);

      // --- Composition Generator (Codex writes Reel.tsx) ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Generating Remotion composition`);
      const composition = await generateComposition({
        script,
        mediaManifest,
        hasLogo,
        hasMusic: music.buffer.length > 0,
      });
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Composition: ${composition.reelTsx.length} chars Reel.tsx`);

      // --- Remotion Render ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Rendering MP4`);
      const renderResult = await renderReel({
        reelTsx: composition.reelTsx,
        dataTsx: composition.dataTsx,
        mediaFiles,
        musicFile: music.buffer.length > 0
          ? { name: "track.mp3", buffer: music.buffer }
          : undefined,
      });
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Rendered in ${renderResult.renderTimeSec.toFixed(1)}s`);

      // Track render + music costs
      const renderCosts = new CostTracker();
      renderCosts.addRenderCall(`reel-render-v${script.variationIndex}`, script.durationSec, renderResult.renderTimeSec);
      renderCosts.addMusicCall(`reel-music-v${script.variationIndex}`, music.source);
      await appendCosts(jobId, renderCosts.toJSON());

      // --- Upload to Supabase Storage ---
      const timestamp = Date.now();
      const storagePath = `${ctx.schoolId}/${requestId}/ai/${script.variationIndex}/reel-${timestamp}.mp4`;
      const mp4Buffer = await import("node:fs").then((fs) => fs.promises.readFile(renderResult.outputPath));

      await admin.storage
        .from("designs")
        .upload(storagePath, mp4Buffer, { contentType: "video/mp4", upsert: false });
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Uploaded: ${storagePath} (${(mp4Buffer.length / 1024 / 1024).toFixed(1)} MB)`);

      // --- Create variation record ---
      await admin.from("ai_variations").insert({
        job_id: jobId,
        request_id: requestId,
        variation_index: script.variationIndex,
        creative_brief: {
          ...script,
          _compositionCode: composition.reelTsx,
          _musicSource: music.source,
        } as unknown as Record<string, unknown>,
        storage_paths: [storagePath],
        poster_type: "reel",
      });

      // --- Evaluate + Refine ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Evaluating`);
      let currentOutputPath = renderResult.outputPath;
      let currentCleanup = renderResult.cleanup;
      let currentComposition = composition;

      try {
        const evalCosts = new CostTracker();
        const evaluation = await evaluateReel({
          mp4Path: currentOutputPath,
          schoolName: ctx.schoolName,
          reelDirection: script.direction,
          costTracker: evalCosts,
        });
        await appendCosts(jobId, evalCosts.toJSON());
        console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Score: ${evaluation.score}/10`);

        // Refine if score < 7 (max 1 refinement round)
        if (evaluation.score < 7) {
          console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Score below 7, refining composition`);
          try {
            const refined = await refineReelComposition({
              originalCode: currentComposition.reelTsx,
              feedback: evaluation.feedback,
              weaknesses: evaluation.weaknesses,
              script,
              mediaManifest,
              hasLogo,
              hasMusic: music.buffer.length > 0,
            });

            // Re-render with refined code
            console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Re-rendering with refined composition`);
            const refinedRender = await renderReel({
              reelTsx: refined.reelTsx,
              dataTsx: refined.dataTsx,
              mediaFiles,
              musicFile: music.buffer.length > 0
                ? { name: "track.mp3", buffer: music.buffer }
                : undefined,
            });

            // Upload refined version, replacing the original
            const refinedTimestamp = Date.now();
            const refinedPath = `${ctx.schoolId}/${requestId}/ai/${script.variationIndex}/reel-refined-${refinedTimestamp}.mp4`;
            const refinedBuffer = await import("node:fs").then((f) => f.promises.readFile(refinedRender.outputPath));

            await admin.storage
              .from("designs")
              .upload(refinedPath, refinedBuffer, { contentType: "video/mp4", upsert: false });

            // Update variation with refined path and code
            await admin.from("ai_variations")
              .update({
                storage_paths: [refinedPath],
                creative_brief: {
                  ...script,
                  _compositionCode: refined.reelTsx,
                  _musicSource: music.source,
                  _refinement: { originalScore: evaluation.score, feedback: evaluation.feedback },
                } as unknown as Record<string, unknown>,
              })
              .eq("job_id", jobId)
              .eq("variation_index", script.variationIndex);

            console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Refined and re-uploaded: ${refinedPath}`);

            // Cleanup old render, switch to new
            await currentCleanup();
            currentOutputPath = refinedRender.outputPath;
            currentCleanup = refinedRender.cleanup;
          } catch (refineErr) {
            console.warn(`[Worker] Reel ${jobId} | V${script.variationIndex} — Refinement failed (keeping original): ${refineErr instanceof Error ? refineErr.message : refineErr}`);
          }
        }
      } catch (err) {
        console.warn(`[Worker] Reel ${jobId} | V${script.variationIndex} — Eval failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      }

      // Cleanup render temp dir
      await currentCleanup();
    }

    // --- Finalize ---
    await admin
      .from("ai_generation_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    try { await dispatchPendingPushes(); } catch { /* best effort */ }

    console.log(`[Worker] Reel ${jobId} | COMPLETED`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Worker] Reel ${jobId} | FAILED: ${message}`);
    await markFailed(jobId, message);
  }
}
