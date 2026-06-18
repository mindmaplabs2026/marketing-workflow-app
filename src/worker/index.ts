/**
 * Codex Poster Bridge — standalone worker (Phase 2).
 *
 * A long-running process for our own always-on server. It PULLS queued poster
 * jobs from Supabase and runs the full 5-agent pipeline locally (through the
 * model client, which uses Codex when MODEL_ENGINE=codex). The app on Vercel
 * only creates the job row; this worker does the heavy lifting.
 *
 * Run it with:
 *   node --env-file=.env.local --conditions=react-server --import tsx src/worker/index.ts
 *   (or: npm run worker)
 *
 *   --env-file=.env.local   loads Supabase + engine env (standalone process)
 *   --conditions=react-server  neutralizes the "server-only" guard in plain Node
 *   --import tsx            runs the TypeScript directly
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { runPosterPipeline, runReelPipeline } from "@/lib/ai/pipeline-core";
import { runChatEdit } from "@/lib/ai/chat-core";
import { getModelEngineKind } from "@/lib/config/engine";
import { checkFfmpegAvailable } from "@/lib/ai/agent-music";
import { checkWhisperAvailable, whisperBackend } from "@/lib/ai/transcribe";

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

let running = true;
let busy = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ClaimedJob = { id: string; request_id: string; poster_type?: string | null };

/**
 * Atomically claim the oldest queued job by flipping queued → understanding.
 * The conditional `.eq("status", "queued")` guards against two workers grabbing
 * the same job. Returns null if there's nothing to do or we lost the race.
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
  const admin = createAdminClient();

  const { data: candidates, error } = await admin
    .from("ai_generation_jobs")
    .select("id")
    .eq("status", "queued")
    .eq("engine", "local") // only the "Generate with Local AI" jobs; Inngest owns 'cloud'
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[Worker] poll error:", error.message);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  const id = candidates[0].id;
  const { data: claimed } = await admin
    .from("ai_generation_jobs")
    .update({ status: "understanding", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("*");

  if (!claimed || claimed.length === 0) return null; // someone else claimed it
  const row = claimed[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    request_id: row.request_id as string,
    // poster_type column is added in Phase 3; until then default to "single".
    poster_type: (row.poster_type as string | undefined) ?? "single",
  };
}

type ClaimedChatEdit = { id: string; variation_id: string; content: string; page_index: number | null };

/**
 * Atomically claim the oldest queued chat-edit (queued → processing).
 * Mirrors claimNextJob; guards against double-processing.
 */
async function claimNextChatEdit(): Promise<ClaimedChatEdit | null> {
  const admin = createAdminClient();

  const { data: candidates, error } = await admin
    .from("ai_chat_messages")
    .select("id")
    .eq("role", "user")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[Worker] chat poll error:", error.message);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  const id = candidates[0].id;
  const { data: claimed } = await admin
    .from("ai_chat_messages")
    .update({ status: "processing" })
    .eq("id", id)
    .eq("status", "queued")
    .select("id, variation_id, content, page_index");

  if (!claimed || claimed.length === 0) return null;
  const row = claimed[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    variation_id: row.variation_id as string,
    content: row.content as string,
    page_index: (row.page_index as number | null) ?? null,
  };
}

async function processChatEdit(edit: ClaimedChatEdit) {
  const admin = createAdminClient();
  try {
    await runChatEdit({ variationId: edit.variation_id, message: edit.content, pageIndex: edit.page_index });
    await admin.from("ai_chat_messages").update({ status: "done" }).eq("id", edit.id);
    console.log(`[Worker] chat-edit ${edit.id} | done`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Worker] chat-edit ${edit.id} | FAILED: ${message}`);
    await admin.from("ai_chat_messages").update({ status: "failed" }).eq("id", edit.id);
  }
}

async function loop() {
  // Startup checks
  const hasFfmpeg = await checkFfmpegAvailable();
  const hasWhisper = await checkWhisperAvailable();
  console.log(
    `[Worker] started — engine='local', MODEL_ENGINE=${getModelEngineKind()}, poll=${POLL_INTERVAL_MS}ms, ffmpeg=${hasFfmpeg ? "yes" : "NOT FOUND (reel generation will fail)"}, whisper=${hasWhisper ? `yes (${whisperBackend()})` : "no (video transcription disabled)"}`,
  );
  if (!hasFfmpeg) {
    console.warn("[Worker] WARNING: ffmpeg is required for reel generation (music trimming + keyframe extraction). Install with: brew install ffmpeg");
  }
  if (!hasWhisper) {
    console.warn("[Worker] NOTE: Whisper not found — video transcription disabled (Agent 1 uses keyframes only). whisper.cpp: brew install whisper-cpp + set WHISPER_CPP_MODEL; or openai-whisper: pipx install openai-whisper");
  }

  while (running) {
    // 1) Generation jobs take priority.
    let job: ClaimedJob | null = null;
    try {
      job = await claimNextJob();
    } catch (err) {
      console.error("[Worker] claim failed:", err instanceof Error ? err.message : err);
    }
    if (job) {
      busy = true;
      if (job.poster_type === "reel") {
        await runReelPipeline(job.id, job.request_id);
      } else {
        const posterType = job.poster_type === "carousel" ? "carousel" : "single";
        await runPosterPipeline(job.id, job.request_id, posterType);
      }
      busy = false;
      continue;
    }

    // 2) Then chat-edit redesigns.
    let edit: ClaimedChatEdit | null = null;
    try {
      edit = await claimNextChatEdit();
    } catch (err) {
      console.error("[Worker] chat claim failed:", err instanceof Error ? err.message : err);
    }
    if (edit) {
      busy = true;
      await processChatEdit(edit);
      busy = false;
      continue;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.log("[Worker] stopped.");
}

function shutdown(signal: string) {
  console.log(`[Worker] received ${signal} — finishing current job then exiting...`);
  running = false;
  // give an in-flight job a moment; runPosterPipeline handles its own errors.
  const started = Date.now();
  const wait = setInterval(() => {
    if (!busy || Date.now() - started > 120_000) {
      clearInterval(wait);
      process.exit(0);
    }
  }, 500);
}

// Periodic cleanup of orphaned temp dirs (runs every 30 minutes)
async function cleanupOrphanedTempDirs() {
  const tmpBase = await import("node:os").then((os) => os.tmpdir());
  const fsPromises = await import("node:fs").then((f) => f.promises);
  const pathMod = await import("node:path");

  for (const prefix of ["remotion-render", "reel-music", "codex-composition", "codex-refine", "reel-eval"]) {
    const dir = pathMod.join(tmpBase, prefix);
    try {
      const entries = await fsPromises.readdir(dir).catch(() => []);
      for (const entry of entries) {
        const fullPath = pathMod.join(dir, entry);
        const stat = await fsPromises.stat(fullPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 30 * 60_000) {
          await fsPromises.rm(fullPath, { recursive: true, force: true }).catch(() => {});
          console.log(`[Worker] Cleaned orphaned temp dir: ${fullPath}`);
        }
      }
    } catch { /* skip */ }
  }
}

setInterval(cleanupOrphanedTempDirs, 30 * 60_000); // every 30 min

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

loop().catch((err) => {
  console.error("[Worker] fatal:", err);
  process.exit(1);
});
