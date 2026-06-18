import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Local audio transcription via OpenAI Whisper (the `whisper` CLI from the
 * open-source `openai-whisper` package), run as a subprocess — same pattern as
 * how we spawn `ffmpeg` and `codex`. Codex/the ChatGPT subscription does NOT
 * expose transcription, and we deliberately avoid an OpenAI API key, so we use
 * a LOCAL Whisper install instead. It's free, offline, and CPU-only.
 *
 * The transcript (with timestamps) is fed to the Understanding agent so it can
 * pick reel segments by what is actually said/happening, not just by how a
 * keyframe looks — and, for long videos, identify the distinct moments to cut
 * into multiple scenes.
 *
 * Install (one-time, on the worker machine):
 *   pipx install openai-whisper   (or: pip install -U openai-whisper)
 *   # ffmpeg must also be present (already required by the render pipeline)
 * Configurable via env:
 *   WHISPER_CMD   (default "whisper")
 *   WHISPER_MODEL (default "base" — fast; use "small"/"medium" for accuracy)
 */

export type TranscriptSegment = { start: number; end: number; text: string };

const WHISPER_CMD = process.env.WHISPER_CMD ?? "whisper";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "base";

let availabilityCache: boolean | null = null;

/** Probe once whether the Whisper CLI is installed and runnable. */
export async function checkWhisperAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  availabilityCache = await runProc(WHISPER_CMD, ["--help"], 20_000)
    .then(() => true)
    .catch(() => false);
  return availabilityCache;
}

/**
 * Transcribe a video/audio file into timestamped segments. Best-effort: returns
 * null (never throws) if Whisper is unavailable, times out, or produces nothing,
 * so the pipeline always continues with keyframes-only context.
 */
export async function transcribeVideo(
  mediaPath: string,
  opts?: { timeoutMs?: number },
): Promise<TranscriptSegment[] | null> {
  if (!(await checkWhisperAvailable())) return null;

  const timeoutMs = opts?.timeoutMs ?? Number(process.env.WHISPER_TIMEOUT_MS ?? 240_000);
  const outDir = path.join(
    os.tmpdir(),
    "whisper-out",
    `${process.pid}-${Date.now()}-${Math.round(performance.now())}`,
  );
  await fs.mkdir(outDir, { recursive: true });

  try {
    await runProc(
      WHISPER_CMD,
      [
        mediaPath,
        "--model", WHISPER_MODEL,
        "--output_format", "json",
        "--output_dir", outDir,
        "--language", "en",
        "--fp16", "False",      // CPU-safe
        "--verbose", "False",
      ],
      timeoutMs,
    );

    const files = await fs.readdir(outDir);
    const jsonFile = files.find((f) => f.endsWith(".json"));
    if (!jsonFile) return null;

    const data = JSON.parse(await fs.readFile(path.join(outDir, jsonFile), "utf8")) as {
      segments?: { start: number; end: number; text: string }[];
    };
    if (!Array.isArray(data.segments)) return null;

    const segments = data.segments
      .map((s) => ({
        start: Math.round(s.start * 10) / 10,
        end: Math.round(s.end * 10) / 10,
        text: String(s.text ?? "").trim(),
      }))
      .filter((s) => s.text.length > 0);

    return segments.length ? segments : null;
  } catch (err) {
    console.warn(`[Whisper] Transcription failed for ${path.basename(mediaPath)}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render segments as a compact timestamped block for an agent prompt. */
export function formatTranscript(segments: TranscriptSegment[], maxChars = 2000): string {
  const lines = segments.map((s) => `[${s.start}-${s.end}s] ${s.text}`);
  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > maxChars) {
      out += "\n[… transcript truncated …]";
      break;
    }
    out += (out ? "\n" : "") + line;
  }
  return out;
}

function runProc(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}
