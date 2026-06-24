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
import { transcribeVideo, type TranscriptSegment } from "./transcribe";
import { analyzeLogo, extractBrandColors, type LogoProfile } from "./logo-analysis";
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
  const { generateComposition, refineReelComposition, renderWithRepair } = await import("./agent-composition");
  const { evaluateReel } = await import("./agent-reel-evaluator");

  const admin = createAdminClient();
  console.log(`[Worker] Reel Job ${jobId} | START (request ${requestId})`);

  try {
    // --- Agent 1: Understanding (reused as-is) ---
    // Fetch duration cap early — needed for Agent 1's shortlist sizing.
    // The teacher's pick is a CAP, not a target. Actual duration is calculated
    // from curated content after Agent 1.
    const { data: jobRow } = await admin
      .from("ai_generation_jobs")
      .select("reel_duration_sec")
      .eq("id", jobId)
      .single();
    const durationCapSec = (jobRow?.reel_duration_sec as number | null) ?? 120;

    // Be generous with shortlist — we'll trim after calculating natural duration.
    // Allow enough items to fill the cap: duration/3.5 (accounts for shorter scenes).
    const maxShortlist = Math.max(20, Math.ceil(durationCapSec / 3.5));
    console.log(`[Worker] Reel ${jobId} | Duration cap: ${durationCapSec}s → maxShortlist=${maxShortlist}`);

    console.log(`[Worker] Reel ${jobId} | ── Agent 1: Understanding ──`);
    await admin
      .from("ai_generation_jobs")
      .update({ status: "understanding", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const ctx = await fetchContext(requestId, { includeVideos: true });

    // Separate images from videos for Agent 1 processing
    const imageUploads = ctx.images.filter((img) => !img.mimeType?.startsWith("video/"));
    const videoUploads = ctx.images.filter((img) => img.mimeType?.startsWith("video/"));
    console.log(`[Worker] Reel ${jobId} | ${ctx.images.length} uploads (${imageUploads.length} images, ${videoUploads.length} videos), ${ctx.brandAssets.length} brand assets, title="${ctx.title}"`);

    // For videos, extract thumbnail frames so Agent 1 can "see" them.
    // Agent 1's vision API only accepts images, not video files.
    const videoThumbnails: UploadedImage[] = [];
    // Per-video timestamped transcripts (Whisper). Best-effort; empty if Whisper
    // is not installed. Fed to Agent 1 so it can pick segments by content.
    const videoTranscripts: Record<string, TranscriptSegment[]> = {};
    // Per-video orientation (from ffprobe dimensions) — NON-binding context for the
    // creative director + composition writer so they can choose a treatment that
    // doesn't crop a landscape clip to a sliver. Keyed by the video's storage path.
    const videoOrientations: Record<string, "landscape" | "portrait" | "square"> = {};
    if (videoUploads.length > 0) {
      const fsPromises = await import("node:fs").then((m) => m.promises);
      const pathMod = await import("node:path");
      const osMod = await import("node:os");
      const { spawn: spawnProc } = await import("node:child_process");

      const thumbDir = pathMod.join(osMod.tmpdir(), "reel-thumbs", `${process.pid}-${Date.now()}`);
      await fsPromises.mkdir(thumbDir, { recursive: true });

      for (let vi = 0; vi < videoUploads.length; vi++) {
        const vid = videoUploads[vi];
        const vidFilename = vid.path.split("/").pop() ?? `video${vi}.mp4`;
        const safeBase = `v${vi}`;
        const vidPath = pathMod.join(thumbDir, `${safeBase}.mp4`);

        try {
          // Download the video
          const res = await fetch(vid.signedUrl);
          if (!res.ok) {
            console.warn(`[Worker] Reel ${jobId} | Video ${vidFilename}: download failed (${res.status})`);
            continue;
          }
          const vidBuffer = Buffer.from(await res.arrayBuffer());
          await fsPromises.writeFile(vidPath, vidBuffer);
          console.log(`[Worker] Reel ${jobId} | Video ${vidFilename}: downloaded ${(vidBuffer.length / 1024).toFixed(0)} KB`);

          // Transcribe (best-effort, local Whisper) so Agent 1 can pick segments
          // by what's said. No-op if Whisper isn't installed.
          try {
            const segs = await transcribeVideo(vidPath);
            if (segs && segs.length) {
              videoTranscripts[vid.path] = segs;
              console.log(`[Worker] Reel ${jobId} | Video ${vidFilename}: transcribed ${segs.length} segment(s)`);
            }
          } catch { /* best-effort */ }

          // Get video duration + dimensions with ffprobe (one JSON probe).
          let durationSec = 0;
          try {
            const probeResult = await new Promise<{ out: string; err: string }>((resolve, reject) => {
              const child = spawnProc("ffprobe", [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height:format=duration",
                "-of", "json", vidPath,
              ], { stdio: ["ignore", "pipe", "pipe"] });
              let out = "", err = "";
              child.stdout.on("data", (d) => (out += d.toString()));
              child.stderr.on("data", (d) => (err += d.toString()));
              child.on("close", (code) => code === 0 ? resolve({ out: out.trim(), err }) : reject(new Error(`ffprobe exit ${code}: ${err.slice(0, 200)}`)));
              child.on("error", reject);
              setTimeout(() => { child.kill(); reject(new Error("ffprobe timeout")); }, 10000);
            });
            const probe = JSON.parse(probeResult.out) as {
              format?: { duration?: string };
              streams?: { width?: number; height?: number }[];
            };
            durationSec = Math.round(parseFloat(probe.format?.duration ?? "0") * 10) / 10;
            const w = probe.streams?.[0]?.width ?? 0;
            const h = probe.streams?.[0]?.height ?? 0;
            if (w > 0 && h > 0) {
              // 10% tolerance band counts near-square as square.
              const orientation = w > h * 1.1 ? "landscape" : h > w * 1.1 ? "portrait" : "square";
              videoOrientations[vid.path] = orientation;
              console.log(`[Worker] Reel ${jobId} | Video ${vidFilename}: ${w}x${h} → ${orientation}`);
            }
          } catch (probeErr) {
            console.warn(`[Worker] Reel ${jobId} | Video ${vidFilename}: ffprobe failed — ${probeErr instanceof Error ? probeErr.message : probeErr}`);
          }

          // Sample frames EVENLY ACROSS THE WHOLE video so Agent 1 actually "watches"
          // all of it (and can pick trim windows from anywhere). The interval STRETCHES
          // with duration so a long clip is still covered end-to-end within a bounded
          // frame budget — a fixed 2s step + a 10-frame cap previously only sampled the
          // first ~20s. Never denser than every 2s; never more than MAX_FRAMES total.
          const MAX_FRAMES = Number(process.env.REEL_UNDERSTANDING_MAX_FRAMES ?? 50);
          const frameInterval = durationSec > 0 ? Math.max(2, Math.ceil(durationSec / MAX_FRAMES)) : 2;
          const frameCount = durationSec > 0 ? Math.max(1, Math.min(MAX_FRAMES, Math.ceil(durationSec / frameInterval))) : 1;
          const framePattern = pathMod.join(thumbDir, `${safeBase}_frame_%02d.jpg`);

          const ffmpegResult = await new Promise<{ code: number; err: string }>((resolve) => {
            const child = spawnProc("ffmpeg", [
              "-i", vidPath,
              "-vf", `fps=1/${frameInterval}`,
              "-frames:v", String(frameCount),
              "-q:v", "5",
              "-y", framePattern,
            ], { stdio: ["ignore", "pipe", "pipe"] });
            let err = "";
            child.stdout.on("data", () => {});
            child.stderr.on("data", (d) => (err += d.toString()));
            child.on("close", (code) => resolve({ code: code ?? 1, err }));
            child.on("error", (e) => resolve({ code: 1, err: e.message }));
            setTimeout(() => { child.kill(); resolve({ code: 1, err: "timeout" }); }, 30000);
          });

          // Collect extracted frames
          const frameFiles: string[] = [];
          for (let fi = 1; fi <= frameCount; fi++) {
            const fp = pathMod.join(thumbDir, `${safeBase}_frame_${String(fi).padStart(2, "0")}.jpg`);
            if (await fsPromises.stat(fp).then(() => true).catch(() => false)) {
              frameFiles.push(fp);
            }
          }

          if (frameFiles.length === 0 && ffmpegResult.code !== 0) {
            console.warn(`[Worker] Reel ${jobId} | Video ${vidFilename}: frame extraction failed (exit ${ffmpegResult.code}): ${ffmpegResult.err.slice(0, 200)}`);
            // Still include for Remotion even without frames for Agent 1
            videoThumbnails.push({
              path: vid.path, signedUrl: "", mimeType: "video/mp4",
              fileSize: vidBuffer.length, mediaType: "video", durationSec: durationSec || undefined,
            });
            continue;
          }

          // Create one UploadedImage per frame — all share the same video path
          // but each has a different signedUrl (base64) and a timestamp label.
          // Agent 1 sees ALL frames for this video, labeled with their timestamp.
          for (let fi = 0; fi < frameFiles.length; fi++) {
            const frameBuffer = await fsPromises.readFile(frameFiles[fi]);
            const dataUrl = `data:image/jpeg;base64,${frameBuffer.toString("base64")}`;
            const timestampSec = fi * frameInterval;
            videoThumbnails.push({
              path: vid.path,
              signedUrl: dataUrl,
              mimeType: "image/jpeg",
              fileSize: frameBuffer.length,
              mediaType: "video",
              durationSec: durationSec || undefined,
              // Store frame timestamp in a way Agent 1 can use
              _frameTimestamp: timestampSec,
            } as UploadedImage & { _frameTimestamp: number });
          }

          console.log(`[Worker] Reel ${jobId} | Video ${vidFilename}: ${durationSec}s, ${frameFiles.length} frames extracted (every ${frameInterval}s)`);
        } catch (err) {
          console.warn(`[Worker] Reel ${jobId} | Failed to process video ${vidFilename}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // Clean up temp video files (keep thumbnails until Agent 1 is done)
      await fsPromises.rm(thumbDir, { recursive: true, force: true }).catch(() => {});
    }

    // Tag image uploads with mediaType for consistency
    const taggedImages = imageUploads.map((img) => ({ ...img, mediaType: "image" as const }));

    // Agent 1 gets: all images + video frames that have a valid preview
    // (frames with empty signedUrl are skipped for vision but their video
    // path is still available for Remotion via ctx.images)
    const framesWithPreview = videoThumbnails.filter((v) => v.signedUrl);
    const uniqueVideoPathsWithFrames = new Set(framesWithPreview.map((v) => v.path));
    const videosWithNoFrames = videoUploads.filter((v) => !uniqueVideoPathsWithFrames.has(v.path));
    if (videosWithNoFrames.length > 0) {
      console.log(`[Worker] Reel ${jobId} | ${videosWithNoFrames.length} videos have no frames — Agent 1 won't see them, but they'll be available for Remotion`);
    }
    const totalFramesSent = framesWithPreview.length;
    console.log(`[Worker] Reel ${jobId} | Sending ${totalFramesSent} video frames from ${uniqueVideoPathsWithFrames.size} videos to Agent 1`);
    const agent1Images = [...taggedImages, ...framesWithPreview];
    console.log(`[Worker] Reel ${jobId} | Agent1 input: ${agent1Images.length} items (${imageUploads.length} images + ${videoThumbnails.length} video thumbnails)`);

    const a1Costs = new CostTracker();
    const understanding = await runUnderstandingAgent({
      title: ctx.title,
      description: ctx.description,
      images: agent1Images,
      brandAssetTypes: ctx.brandAssets.map((a) => a.assetType),
      schoolGuidelines: ctx.schoolGuidelines,
      maxShortlist,
      videoTranscripts,
    }, a1Costs);
    await appendCosts(jobId, a1Costs.toJSON());

    console.log(`[Worker] Reel ${jobId} | Agent1: theme="${understanding.theme}", ${understanding.curatedImages.length} curated (requested up to ${maxShortlist})`);

    // ─── VALIDATE & CANONICALIZE CURATED PATHS ─────────────────────
    // Agent 1 is shown the real upload paths, but the model sometimes echoes its
    // own vision labels instead (e.g. "img11.jpg" — the names the Codex bridge
    // assigns to attached images), or returns a video keyframe thumbnail as if it
    // were a still upload. Those phantom paths match no real file, so the media
    // download logs "Media not found" and the render 404s. Drop any curated item
    // that maps to no REAL uploaded file, and canonicalize matched items to the
    // real storage path + correct mediaType.
    const realUploads = [
      ...imageUploads.map((u) => ({ path: u.path, mediaType: "image" as const })),
      ...videoUploads.map((u) => ({ path: u.path, mediaType: "video" as const })),
    ];
    const matchRealUpload = (curatedPath: string) => {
      const fn = curatedPath.split("/").pop() ?? "";
      return (
        realUploads.find((u) => u.path === curatedPath) ??
        realUploads.find((u) => u.path.endsWith(curatedPath) || curatedPath.endsWith(u.path)) ??
        realUploads.find((u) => (u.path.split("/").pop() ?? "") === fn) ??
        null
      );
    };
    {
      const validated: typeof understanding.curatedImages = [];
      let droppedPhantom = 0;
      for (const c of understanding.curatedImages) {
        const real = matchRealUpload(c.path);
        if (real) {
          validated.push({ ...c, path: real.path, mediaType: real.mediaType });
        } else {
          droppedPhantom++;
        }
      }
      understanding.curatedImages = validated;
      if (droppedPhantom > 0) {
        console.log(`[Worker] Reel ${jobId} | Dropped ${droppedPhantom} phantom curated item(s) matching no real upload (likely keyframe/vision labels). ${validated.length} remain.`);
      }
    }

    // PROGRAMMATIC VIDEO INJECTION: Agent 1 often drops videos from the curated
    // list because still frames look worse than photos. For reels, videos are
    // essential. Force-add any missing videos into the curated list.
    const videoPathsInUpload = new Set(videoUploads.map((v) => v.path));
    const curatedVideoPaths = new Set(
      understanding.curatedImages
        .filter((c) => c.mediaType === "video")
        .map((c) => c.path),
    );

    // Also check by filename match (Agent 1 might use slightly different paths)
    const curatedPathFilenames = new Set(
      understanding.curatedImages.map((c) => c.path.split("/").pop()),
    );

    // Build video metadata map from the thumbnail extraction step
    const videoMeta = new Map<string, { durationSec?: number }>();
    for (const vt of videoThumbnails) {
      if (vt.mediaType === "video" && !videoMeta.has(vt.path)) {
        videoMeta.set(vt.path, { durationSec: vt.durationSec });
      }
    }

    let injectedCount = 0;
    for (const vid of videoUploads) {
      const filename = vid.path.split("/").pop() ?? "";
      const alreadyCurated = curatedVideoPaths.has(vid.path) || curatedPathFilenames.has(filename);
      if (!alreadyCurated) {
        const meta = videoMeta.get(vid.path);
        understanding.curatedImages.push({
          path: vid.path,
          relevanceScore: 70, // reasonable default
          description: `Video clip (${meta?.durationSec ?? "?"}s) — injected programmatically because Agent 1 dropped it`,
          quality: "medium",
          mediaType: "video",
          durationSec: meta?.durationSec,
        });
        injectedCount++;
      }
    }

    if (injectedCount > 0) {
      console.log(`[Worker] Reel ${jobId} | Injected ${injectedCount} videos into curated list (Agent 1 dropped them). Now ${understanding.curatedImages.length} curated total.`);
    } else {
      const curatedVideoCount = understanding.curatedImages.filter((c) => c.mediaType === "video").length;
      console.log(`[Worker] Reel ${jobId} | Agent 1 included ${curatedVideoCount}/${videoUploads.length} videos in curated list`);
    }

    // ─── CONTENT-DRIVEN DURATION CALCULATOR (PER-SCENE) ────────────
    // The requested duration is a TARGET, not just a ceiling. We measure how much
    // the curated content can fill, scene by scene, and target min(requested,
    // capacity) — filling toward the request when there's material, staying short
    // (no padding) when there isn't.
    //
    // The cap is PER SCENE, not per source file. A single long video (e.g. a
    // 10-min montage of many moments) is therefore not limited to one short clip:
    // it can supply MANY scenes, each a different trim window. If the model didn't
    // curate enough segments to reach the target, we deterministically EXPAND —
    // adding evenly-spaced trim windows across each long video — so one long clip
    // can fill the whole reel. (The transcript-guided Agent 1 below produces the
    // best windows; this expansion is the guarantee we never starve the duration.)
    const TITLE_CLOSING_SEC = 8;   // 4s title + 4s closing
    const IMAGE_SCENE_SEC = 4;     // seconds per image scene
    const MIN_VIDEO_SCENE_SEC = Number(process.env.REEL_MIN_VIDEO_SCENE_SEC ?? 4);
    const MAX_VIDEO_SCENE_SEC = Number(process.env.REEL_MAX_VIDEO_SCENE_SEC ?? 8); // per SCENE
    const MAX_SEGMENTS_PER_VIDEO = Number(process.env.REEL_MAX_SEGMENTS_PER_VIDEO ?? 24);
    const VIDEO_TRIM_DEFAULT = 6;  // used when a clip's real length is unknown
    const target = Math.min(durationCapSec, 300);

    // Length one curated video ENTRY occupies as a single scene.
    const videoSceneLen = (v: { suggestedTrimStart?: number; suggestedTrimEnd?: number; durationSec?: number }): number => {
      if (v.suggestedTrimStart != null && v.suggestedTrimEnd != null) {
        return Math.max(MIN_VIDEO_SCENE_SEC, Math.min(v.suggestedTrimEnd - v.suggestedTrimStart, MAX_VIDEO_SCENE_SEC));
      }
      if (v.durationSec && v.durationSec > 0) {
        return Math.max(MIN_VIDEO_SCENE_SEC, Math.min(v.durationSec, MAX_VIDEO_SCENE_SEC));
      }
      return VIDEO_TRIM_DEFAULT;
    };
    const computeCapacity = () => {
      const vids = understanding.curatedImages.filter((c) => c.mediaType === "video");
      const imgs = understanding.curatedImages.filter((c) => c.mediaType !== "video");
      const v = vids.reduce((s, x) => s + videoSceneLen(x), 0);
      const i = imgs.length * IMAGE_SCENE_SEC;
      return { total: TITLE_CLOSING_SEC + v + i, v, i, nVid: vids.length, nImg: imgs.length };
    };

    let cap = computeCapacity();

    // EXPANSION: under target + videos have unused footage → add spread-out segments.
    if (cap.total < target) {
      const videoPaths = [...new Set(
        understanding.curatedImages.filter((c) => c.mediaType === "video").map((c) => c.path),
      )];
      // Precompute evenly-spaced candidate windows per video, skipping any that
      // overlap a segment the model already curated.
      const candidates = new Map<string, { start: number; end: number }[]>();
      for (const vp of videoPaths) {
        const realDur = videoMeta.get(vp)?.durationSec ?? 0;
        if (realDur < MIN_VIDEO_SCENE_SEC * 2) continue; // too short to split further
        const existing = understanding.curatedImages
          .filter((c) => c.path === vp && c.mediaType === "video")
          .map((c) => [c.suggestedTrimStart ?? 0, c.suggestedTrimEnd ?? MAX_VIDEO_SCENE_SEC] as const);
        const n = Math.min(MAX_SEGMENTS_PER_VIDEO, Math.floor(realDur / MAX_VIDEO_SCENE_SEC));
        const stride = realDur / Math.max(1, n);
        const wins: { start: number; end: number }[] = [];
        for (let k = 0; k < n; k++) {
          const start = Math.round(k * stride);
          const end = Math.min(Math.round(realDur), start + MAX_VIDEO_SCENE_SEC);
          if (end - start < MIN_VIDEO_SCENE_SEC) continue;
          if (existing.some(([s, e]) => start < e && end > s)) continue; // overlaps existing
          wins.push({ start, end });
        }
        if (wins.length) candidates.set(vp, wins);
      }
      // Round-robin draw windows across videos until target reached or dry.
      let added = 0;
      let progress = true;
      while (cap.total < target && progress) {
        progress = false;
        for (const vp of videoPaths) {
          if (cap.total >= target) break;
          const wins = candidates.get(vp);
          if (!wins || wins.length === 0) continue;
          const w = wins.shift()!;
          understanding.curatedImages.push({
            path: vp,
            relevanceScore: 60,
            description: `Additional segment (${w.start}-${w.end}s) from a long video — added to fill the requested ${durationCapSec}s`,
            quality: "medium",
            mediaType: "video",
            durationSec: videoMeta.get(vp)?.durationSec,
            suggestedTrimStart: w.start,
            suggestedTrimEnd: w.end,
          });
          added++;
          cap = computeCapacity();
          progress = true;
        }
      }
      if (added > 0) {
        console.log(`[Worker] Reel ${jobId} | Expanded ${added} extra video segment(s) from long clip(s) to fill ${target}s.`);
      }
    }

    const effectiveDuration = Math.min(target, cap.total);
    console.log(`[Worker] Reel ${jobId} | Duration calc: ${cap.nVid} video scene(s) (${Math.round(cap.v)}s, ≤${MAX_VIDEO_SCENE_SEC}s each) + ${cap.nImg} image(s) (${Math.round(cap.i)}s) + ${TITLE_CLOSING_SEC}s chrome = ${Math.round(cap.total)}s capacity`);
    console.log(`[Worker] Reel ${jobId} | Effective duration: ${effectiveDuration}s (requested: ${durationCapSec}s, content capacity: ${Math.round(cap.total)}s)`);

    // If capacity exceeds the target, trim lowest-relevance IMAGES first (keep all
    // video scenes — videos are the priority for reels).
    if (cap.total > target) {
      const excessSec = cap.total - target;
      const imagesToDrop = Math.ceil(excessSec / IMAGE_SCENE_SEC);
      const imgEntries = understanding.curatedImages.filter((c) => c.mediaType !== "video");
      if (imagesToDrop > 0 && imgEntries.length > imagesToDrop) {
        const sortedImages = [...imgEntries].sort((a, b) => a.relevanceScore - b.relevanceScore);
        const dropPaths = new Set(sortedImages.slice(0, imagesToDrop).map((c) => c.path));
        understanding.curatedImages = understanding.curatedImages.filter(
          (c) => c.mediaType === "video" || !dropPaths.has(c.path),
        );
        cap = computeCapacity();
        console.log(`[Worker] Reel ${jobId} | Trimmed ${imagesToDrop} lowest-relevance image(s) to fit ${target}s. Capacity now ${Math.round(cap.total)}s.`);
      }
    }

    await admin
      .from("ai_generation_jobs")
      .update({ status: "creative", agent1_output: understanding as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Agent 2: Reel Script ---
    console.log(`[Worker] Reel ${jobId} | ── Agent 2: Reel Script ──`);

    // Give the creative director the ACTUAL footage to look at: one image URL per
    // unique curated path (a video uses one of its keyframes). Low detail; capped.
    const curatedMediaForDirector: { path: string; url: string; mediaType: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }[] = [];
    {
      const seen = new Set<string>();
      for (const c of understanding.curatedImages) {
        if (seen.has(c.path)) continue;
        seen.add(c.path);
        const url = c.mediaType === "video"
          ? videoThumbnails.find((v) => v.path === c.path && v.signedUrl)?.signedUrl
          : ctx.images.find((i) => i.path === c.path)?.signedUrl;
        if (url) {
          curatedMediaForDirector.push({
            path: c.path,
            url,
            mediaType: c.mediaType ?? "image",
            description: c.description,
            orientation: c.mediaType === "video" ? videoOrientations[c.path] : undefined,
          });
        }
        if (curatedMediaForDirector.length >= 15) break;
      }
    }

    // Extract brand anchor colours from the logo so palettes stay on-brand.
    let brandColors: string[] = [];
    let logoProfile: LogoProfile | undefined;
    const logoForColors = ctx.brandAssets.find((a) => a.assetType === "logo");
    if (logoForColors?.storagePath) {
      try {
        const { data } = await admin.storage.from("school-assets").download(logoForColors.storagePath);
        if (data) {
          const logoBuf = Buffer.from(await data.arrayBuffer());
          brandColors = await extractBrandColors(logoBuf);
          logoProfile = (await analyzeLogo(logoBuf)) ?? undefined;
        }
      } catch { /* best-effort */ }
    }
    if (brandColors.length) {
      console.log(`[Worker] Reel ${jobId} | Brand colours from logo: ${brandColors.join(", ")}`);
    }
    if (logoProfile) {
      console.log(`[Worker] Reel ${jobId} | Logo profile: tone=${logoProfile.tone}, transparency=${logoProfile.hasTransparency}, needs ${logoProfile.requiredBackground} background`);
    }

    const a2Costs = new CostTracker();
    const reelCreative = await runReelCreativeAgent({
      understanding,
      brandAssets: ctx.brandAssets.map((a) => ({
        assetType: a.assetType,
        storagePath: a.storagePath,
        signedUrl: a.signedUrl,
        label: a.label,
      })),
      requestedDurationSec: effectiveDuration,
      schoolName: ctx.schoolName,
      schoolGuidelines: ctx.schoolGuidelines,
      curatedMedia: curatedMediaForDirector,
      brandColors,
      logoProfile,
    }, a2Costs);
    await appendCosts(jobId, a2Costs.toJSON());

    await admin
      .from("ai_generation_jobs")
      .update({ status: "music", agent2_output: reelCreative as unknown as Record<string, unknown> })
      .eq("id", jobId);

    // --- Download all curated media + brand assets ONCE (shared by every
    //     variation). The media set is identical across variations, so fetching
    //     it a single time up front avoids redundant re-downloads AND removes any
    //     chance of a later variation rendering with missing media (the earlier
    //     per-variation download could expire/fail mid-job). ---
    const mediaFiles = new Map<string, Buffer>();
    const mediaManifest = new Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>();
    const allMediaPaths = new Set<string>();
    for (const v of reelCreative.variations) {
      for (const s of v.scenes) if (s.mediaPath) allMediaPaths.add(s.mediaPath);
    }
    for (const mediaPath of allMediaPaths) {
      const match = ctx.images.find((img: UploadedImage) => img.path === mediaPath);
      if (!match) {
        console.warn(`[Worker] Reel ${jobId} | Media not found: ${mediaPath}`);
        continue;
      }
      // Type from the actual MIME (authoritative), not Agent 2's guess.
      const isVideo = match.mimeType?.startsWith("video/") ?? /\.(mp4|mov|webm|avi)$/i.test(mediaPath);
      try {
        // Admin (service-role) download — no signed-URL expiry on long jobs.
        const { data: fileData, error: dlErr } = await admin.storage
          .from("request-uploads")
          .download(match.path);
        if (dlErr || !fileData) {
          console.warn(`[Worker] Reel ${jobId} | Failed to download: ${mediaPath} (${dlErr?.message ?? "no data"})`);
          continue;
        }
        const buf = Buffer.from(await fileData.arrayBuffer());
        const filename = mediaPath.split("/").pop() ?? "media.bin";
        mediaFiles.set(filename, buf);
        const curatedInfo = understanding.curatedImages.find((c) => c.path === mediaPath);
        mediaManifest.set(filename, {
          type: isVideo ? "video" : "image",
          description: curatedInfo?.description ?? "uploaded media",
          orientation: isVideo ? videoOrientations[mediaPath] : undefined,
        });
        console.log(`[Worker] Reel ${jobId} | Downloaded: ${filename} (${isVideo ? "video" : "image"}, ${(buf.length / 1024).toFixed(0)} KB)`);
      } catch {
        console.warn(`[Worker] Reel ${jobId} | Failed to download: ${mediaPath}`);
      }
    }

    // Brand assets (logo + footer), once.
    let hasLogo = false;
    let hasFooter = false;
    const logoAsset = ctx.brandAssets.find((a) => a.assetType === "logo");
    if (logoAsset?.storagePath) {
      try {
        const { data } = await admin.storage.from("school-assets").download(logoAsset.storagePath);
        if (data) { mediaFiles.set("logo.png", Buffer.from(await data.arrayBuffer())); hasLogo = true; }
      } catch { /* skip */ }
    }
    const footerAsset = ctx.brandAssets.find((a) => a.assetType === "footer");
    if (footerAsset?.storagePath) {
      try {
        const { data } = await admin.storage.from("school-assets").download(footerAsset.storagePath);
        if (data) { mediaFiles.set("footer.png", Buffer.from(await data.arrayBuffer())); hasFooter = true; }
      } catch { /* skip */ }
    }
    console.log(`[Worker] Reel ${jobId} | Downloaded ${mediaFiles.size} shared media files (logo=${hasLogo}, footer=${hasFooter}) for ${reelCreative.variations.length} variation(s)`);

    // Tracks Jamendo track keys used across this job's variations, so two
    // variations never get the same audio (popular tracks otherwise win every
    // keyword set). Shared by reference into each renderVariation call.
    const usedMusicKeys = new Set<string>();

    // Render one variation in full isolation. Returns true on success.
    // A single variation's failure (bad Codex output, render crash, OOM, or a
    // transient upload error) must NOT abort its siblings or fail the whole job.
    // Captures the shared mediaFiles/mediaManifest/hasLogo/hasFooter above.
    const renderVariation = async (
      script: (typeof reelCreative.variations)[number],
    ): Promise<boolean> => {
      console.log(`[Worker] Reel ${jobId} | ── Variation ${script.variationIndex} ──`);

      // --- Music Discovery ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Finding music: [${script.musicMood.join(", ")}] ${script.musicTempo}`);
      const music = await findAndTrimMusic({
        musicMood: script.musicMood,
        musicTempo: script.musicTempo,
        durationSec: script.durationSec,
        excludeKeys: usedMusicKeys, // don't reuse a track another variation already used
      });
      if (music.trackKey) usedMusicKeys.add(music.trackKey);
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Music: ${music.source}, ${(music.buffer.length / 1024).toFixed(0)} KB`);

      // Update status to generating for the first variation
      if (script.variationIndex === 1) {
        await admin
          .from("ai_generation_jobs")
          .update({ status: "generating" })
          .eq("id", jobId);
      }

      // Media + brand assets are downloaded ONCE for the whole job (shared across
      // all variations) — see the shared download block above the loop.

      // --- Composition Generator (Codex writes Reel.tsx) ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Generating Remotion composition`);
      let composition = await generateComposition({
        script,
        mediaManifest,
        hasLogo,
        logoProfile,
        hasFooter,
        hasMusic: music.buffer.length > 0,
      });
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Composition: ${composition.reelTsx.length} chars Reel.tsx`);

      // --- Remotion Render (self-correcting: feed compile/render errors back to Codex) ---
      const musicFile = music.buffer.length > 0
        ? { name: "track.mp3", buffer: music.buffer }
        : undefined;
      const { renderResult, composition: workingComposition, usedFallback } = await renderWithRepair({
        composition,
        script,
        assets: { mediaFiles, mediaManifest, musicFile, hasLogo, logoProfile, hasFooter, hasMusic: music.buffer.length > 0 },
        label: `V${script.variationIndex}`,
      });
      composition = workingComposition;
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Rendered in ${renderResult.renderTimeSec.toFixed(1)}s${usedFallback ? " (fallback slideshow)" : ""}`);

      // Track render + music costs
      const renderCosts = new CostTracker();
      renderCosts.addRenderCall(`reel-render-v${script.variationIndex}`, script.durationSec, renderResult.renderTimeSec);
      renderCosts.addMusicCall(`reel-music-v${script.variationIndex}`, music.source);
      await appendCosts(jobId, renderCosts.toJSON());

      // --- Upload to Supabase Storage ---
      const timestamp = Date.now();
      const storagePath = `${ctx.schoolId}/${requestId}/ai/${script.variationIndex}/reel-${timestamp}.mp4`;
      const mp4Buffer = await import("node:fs").then((fs) => fs.promises.readFile(renderResult.outputPath));

      const { error: uploadErr } = await admin.storage
        .from("designs")
        .upload(storagePath, mp4Buffer, { contentType: "video/mp4", upsert: true });
      if (uploadErr) {
        console.error(`[Worker] Reel ${jobId} | V${script.variationIndex} — UPLOAD FAILED: ${uploadErr.message}`);
        throw new Error(`Storage upload failed: ${uploadErr.message}`);
      }
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Uploaded: ${storagePath} (${(mp4Buffer.length / 1024 / 1024).toFixed(1)} MB)`);

      // --- Persist the trimmed music track so chat-edits can reuse the exact
      //     soundtrack (the buffer is otherwise dropped with the temp workdir). ---
      let musicPath: string | undefined;
      if (music.buffer.length > 0 && music.source !== "fallback-silent") {
        musicPath = `${ctx.schoolId}/${requestId}/ai/${script.variationIndex}/music.mp3`;
        const { error: musicUploadErr } = await admin.storage
          .from("designs")
          .upload(musicPath, music.buffer, { contentType: "audio/mpeg", upsert: true });
        if (musicUploadErr) {
          console.warn(`[Worker] Reel ${jobId} | V${script.variationIndex} — Music persist failed (non-fatal): ${musicUploadErr.message}`);
          musicPath = undefined;
        }
      }

      // --- Create variation record ---
      await admin.from("ai_variations").insert({
        job_id: jobId,
        request_id: requestId,
        variation_index: script.variationIndex,
        creative_brief: {
          ...script,
          _compositionCode: composition.reelTsx,
          _compositionDataCode: composition.dataTsx,
          _musicSource: music.source,
          _musicPath: musicPath,
          _musicAttribution: music.attribution ?? null,
        } as unknown as Record<string, unknown>,
        storage_paths: [storagePath],
        poster_type: "reel",
      });

      // --- Evaluate + Refine ---
      console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Evaluating`);
      let currentOutputPath = renderResult.outputPath;
      let currentCleanup = renderResult.cleanup;
      const currentComposition = composition;

      try {
        const evalCosts = new CostTracker();
        const evaluation = await evaluateReel({
          mp4Path: currentOutputPath,
          schoolName: ctx.schoolName,
          reelDirection: script.direction,
          artDirection: {
            visualRegister: script.visualRegister,
            colorPalette: script.colorPalette,
            typography: script.typography,
          },
          costTracker: evalCosts,
        });
        await appendCosts(jobId, evalCosts.toJSON());
        console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Score: ${evaluation.score}/10`);

        // Refine loop: up to MAX_REFINE_ROUNDS, RE-EVALUATING after each round and
        // stopping as soon as we clear PASS_SCORE (hard stop). We KEEP THE BEST-scoring
        // render across all rounds — a refine can come back worse, and we never ship a
        // regression. Only the best is left uploaded in storage + the variation record.
        // Env-tunable: renders are slow (~5 min each), so each refine round adds
        // real wall-clock. Lower MAX_REFINE_ROUNDS to 0 to disable refinement, or
        // lower PASS_SCORE so "good enough" reels skip the extra renders.
        const PASS_SCORE = Number(process.env.REEL_PASS_SCORE ?? 7);
        const MAX_REFINE_ROUNDS = Number(process.env.REEL_MAX_REFINE_ROUNDS ?? 2);
        let bestScore = evaluation.score;
        let bestComposition = currentComposition;
        let bestFeedback = evaluation.feedback;
        let bestWeaknesses = evaluation.weaknesses;
        let bestStoragePath = storagePath;
        // Located findings + the rendered keyframes that show them — handed to the refiner
        // so it acts on precise, visual defects (kept in memory; keyframes are NOT stored).
        let bestFindings = evaluation.findings;
        let bestKeyframes = evaluation.keyframes;

        // Full audit trail of every evaluation + the exact instructions handed to the
        // refiner each round. Persisted to creative_brief._evaluations below so you can
        // inspect, in the DB, what the evaluator said and what the refiner was told.
        // (Keyframes are excluded — too large for the row.)
        const evaluations: Array<Record<string, unknown>> = [
          {
            round: 0,
            score: evaluation.score,
            dimensions: evaluation.dimensions,
            strengths: evaluation.strengths,
            weaknesses: evaluation.weaknesses,
            findings: evaluation.findings,
            feedback: evaluation.feedback,
          },
        ];

        for (let round = 1; round <= MAX_REFINE_ROUNDS && bestScore < PASS_SCORE; round++) {
          console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Score ${bestScore}/10 < ${PASS_SCORE}, refine round ${round}/${MAX_REFINE_ROUNDS}`);
          try {
            // The exact instructions handed to the refiner THIS round (captured for the audit trail).
            const instructionsToRefiner = { feedback: bestFeedback, weaknesses: bestWeaknesses, findings: bestFindings };
            // Refine from the BEST composition so far, using its located findings + keyframes.
            const refined = await refineReelComposition({
              originalCode: bestComposition.reelTsx,
              feedback: bestFeedback,
              weaknesses: bestWeaknesses,
              findings: bestFindings,
              keyframes: bestKeyframes,
              script,
              mediaManifest,
              hasLogo,
              logoProfile,
              hasMusic: music.buffer.length > 0,
            });

            // Re-render (with self-repair so a compile slip doesn't abort the round).
            console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Re-rendering (round ${round})`);
            const { renderResult: refinedRender, composition: refinedComposition } = await renderWithRepair({
              composition: refined,
              script,
              assets: { mediaFiles, mediaManifest, musicFile, hasLogo, logoProfile, hasFooter, hasMusic: music.buffer.length > 0 },
              label: `V${script.variationIndex} refine r${round}`,
            });

            // Re-EVALUATE the refined render — this is what makes the loop real.
            const refinedEvalCosts = new CostTracker();
            const refinedEval = await evaluateReel({
              mp4Path: refinedRender.outputPath,
              schoolName: ctx.schoolName,
              reelDirection: script.direction,
              artDirection: {
                visualRegister: script.visualRegister,
                colorPalette: script.colorPalette,
                typography: script.typography,
              },
              costTracker: refinedEvalCosts,
            });
            await appendCosts(jobId, refinedEvalCosts.toJSON());
            console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Round ${round} score: ${refinedEval.score}/10 (best so far ${bestScore}/10)`);
            evaluations.push({
              round,
              instructionsToRefiner,
              score: refinedEval.score,
              dimensions: refinedEval.dimensions,
              strengths: refinedEval.strengths,
              weaknesses: refinedEval.weaknesses,
              findings: refinedEval.findings,
              feedback: refinedEval.feedback,
              accepted: refinedEval.score > bestScore,
            });

            if (refinedEval.score > bestScore) {
              // New best — upload it and point the variation record at it.
              const refinedPath = `${ctx.schoolId}/${requestId}/ai/${script.variationIndex}/reel-refined-r${round}-${Date.now()}.mp4`;
              const refinedBuffer = await import("node:fs").then((f) => f.promises.readFile(refinedRender.outputPath));
              const { error: refinedUploadErr } = await admin.storage
                .from("designs")
                .upload(refinedPath, refinedBuffer, { contentType: "video/mp4", upsert: true });
              if (refinedUploadErr) {
                console.error(`[Worker] Reel ${jobId} | V${script.variationIndex} — Refined upload FAILED (keeping best): ${refinedUploadErr.message}`);
                await refinedRender.cleanup();
              } else {
                await admin.from("ai_variations")
                  .update({
                    storage_paths: [refinedPath],
                    creative_brief: {
                      ...script,
                      _compositionCode: refinedComposition.reelTsx,
                      _compositionDataCode: refinedComposition.dataTsx,
                      _musicSource: music.source,
                      _musicPath: musicPath,
                      _musicAttribution: music.attribution ?? null,
                      _refinement: { rounds: round, originalScore: evaluation.score, score: refinedEval.score, feedback: refinedEval.feedback },
                    } as unknown as Record<string, unknown>,
                  })
                  .eq("job_id", jobId)
                  .eq("variation_index", script.variationIndex);
                console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Round ${round} improved ${bestScore}→${refinedEval.score}, re-uploaded: ${refinedPath}`);
                // Swap the kept render to the new best; drop the previous one.
                await currentCleanup();
                currentOutputPath = refinedRender.outputPath;
                currentCleanup = refinedRender.cleanup;
                bestScore = refinedEval.score;
                bestComposition = refinedComposition;
                bestFeedback = refinedEval.feedback;
                bestWeaknesses = refinedEval.weaknesses;
                bestFindings = refinedEval.findings;
                bestKeyframes = refinedEval.keyframes;
                bestStoragePath = refinedPath;
              }
            } else {
              // Not better — discard the refined render, keep the current best.
              console.log(`[Worker] Reel ${jobId} | V${script.variationIndex} — Round ${round} did not improve (${refinedEval.score} ≤ ${bestScore}), keeping best`);
              await refinedRender.cleanup();
            }
          } catch (refineErr) {
            console.warn(`[Worker] Reel ${jobId} | V${script.variationIndex} — Refine round ${round} failed (keeping best): ${refineErr instanceof Error ? refineErr.message : refineErr}`);
            break;
          }
        }

        // Authoritative final write: persist the BEST composition + the FULL eval/refine
        // audit trail (every round's scores, weaknesses, feedback, and the exact
        // instructions handed to the refiner). Inspect it in Supabase →
        // ai_variations.creative_brief._evaluations.
        await admin.from("ai_variations")
          .update({
            storage_paths: [bestStoragePath],
            creative_brief: {
              ...script,
              _compositionCode: bestComposition.reelTsx,
              _compositionDataCode: bestComposition.dataTsx,
              _musicSource: music.source,
              _musicPath: musicPath,
              _musicAttribution: music.attribution ?? null,
              _refinement: { rounds: evaluations.length - 1, originalScore: evaluation.score, finalScore: bestScore },
              _evaluations: evaluations,
            } as unknown as Record<string, unknown>,
          })
          .eq("job_id", jobId)
          .eq("variation_index", script.variationIndex);
      } catch (err) {
        console.warn(`[Worker] Reel ${jobId} | V${script.variationIndex} — Eval failed (non-fatal): ${err instanceof Error ? err.message : err}`);
      }

      // Cleanup render temp dir
      await currentCleanup();
      return true;
    };

    // Run variations sequentially (avoids OOM) but isolated — one failure is
    // logged and skipped so successful variations still complete the job.
    let succeeded = 0;
    for (const script of reelCreative.variations) {
      try {
        if (await renderVariation(script)) succeeded++;
      } catch (err) {
        console.error(
          `[Worker] Reel ${jobId} | V${script.variationIndex} — FAILED (skipping): ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    if (succeeded === 0) {
      throw new Error(
        `All ${reelCreative.variations.length} reel variation(s) failed to render`,
      );
    }
    console.log(
      `[Worker] Reel ${jobId} | ${succeeded}/${reelCreative.variations.length} variation(s) succeeded`,
    );

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
