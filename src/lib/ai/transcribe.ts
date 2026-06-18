import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Local audio transcription, run as a subprocess (same pattern as ffmpeg/codex).
 * Codex / the ChatGPT subscription does NOT expose transcription, and we avoid an
 * OpenAI API key, so transcription runs LOCALLY — free, offline, CPU/GPU on the
 * worker machine. The timestamped transcript is fed to the Understanding agent so
 * it can pick reel segments by what is actually said and split long videos into
 * multiple scenes.
 *
 * TWO BACKENDS, auto-selected:
 *   • whisper.cpp (preferred — fast, no Python; Metal-accelerated on macOS).
 *       Selected when WHISPER_CPP_MODEL points at a ggml model file.
 *       Install: brew install whisper-cpp
 *       Model:   download a ggml model, e.g.
 *                curl -L -o ggml-base.en.bin \
 *                  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
 *       Env:     WHISPER_CPP_MODEL=/abs/path/ggml-base.en.bin
 *                WHISPER_CPP_BIN=whisper-cli            (default)
 *   • openai-whisper Python CLI (fallback when no cpp model is configured).
 *       Install: pipx install openai-whisper
 *       Env:     WHISPER_CMD=whisper   WHISPER_MODEL=base
 *
 * whisper.cpp needs 16 kHz mono WAV input, so we transcode with ffmpeg first.
 * openai-whisper ingests the video directly. Both emit timestamped segments.
 */

export type TranscriptSegment = { start: number; end: number; text: string };

const CPP_MODEL = process.env.WHISPER_CPP_MODEL;            // presence => use whisper.cpp
const CPP_BIN = process.env.WHISPER_CPP_BIN ?? "whisper-cli";
const OPENAI_CMD = process.env.WHISPER_CMD ?? "whisper";
const OPENAI_MODEL = process.env.WHISPER_MODEL ?? "base";

type Backend = "cpp" | "openai";
const backend: Backend = CPP_MODEL ? "cpp" : "openai";

let availabilityCache: boolean | null = null;

/** Probe once whether the selected Whisper backend is installed and runnable. */
export async function checkWhisperAvailable(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache;
  if (backend === "cpp") {
    const modelOk = await fs.stat(CPP_MODEL!).then(() => true).catch(() => false);
    availabilityCache = modelOk && (await commandExists(CPP_BIN));
  } else {
    availabilityCache = await commandExists(OPENAI_CMD);
  }
  return availabilityCache;
}

/** Which backend will be used (for startup logging). */
export function whisperBackend(): Backend {
  return backend;
}

/**
 * Transcribe a video/audio file into timestamped segments. Best-effort: returns
 * null (never throws) if Whisper is unavailable, times out, or yields nothing,
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
    return backend === "cpp"
      ? await transcribeWithCpp(mediaPath, outDir, timeoutMs)
      : await transcribeWithOpenAI(mediaPath, outDir, timeoutMs);
  } catch (err) {
    console.warn(`[Whisper] Transcription failed for ${path.basename(mediaPath)}: ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** whisper.cpp: ffmpeg → 16 kHz mono WAV → whisper-cli -oj → parse transcription[]. */
async function transcribeWithCpp(
  mediaPath: string,
  outDir: string,
  timeoutMs: number,
): Promise<TranscriptSegment[] | null> {
  const wav = path.join(outDir, "audio.wav");
  await runProc(
    "ffmpeg",
    ["-i", mediaPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "-y", wav],
    60_000,
  );

  const ofBase = path.join(outDir, "out");
  await runProc(
    CPP_BIN,
    ["-m", CPP_MODEL!, "-f", wav, "-l", "en", "-oj", "-of", ofBase],
    timeoutMs,
  );

  const data = JSON.parse(await fs.readFile(`${ofBase}.json`, "utf8")) as {
    transcription?: { offsets?: { from: number; to: number }; text?: string }[];
  };
  if (!Array.isArray(data.transcription)) return null;

  const segments = data.transcription
    .map((s) => ({
      start: Math.round((s.offsets?.from ?? 0) / 100) / 10, // ms → s (1 decimal)
      end: Math.round((s.offsets?.to ?? 0) / 100) / 10,
      text: String(s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0);

  return segments.length ? segments : null;
}

/** openai-whisper Python CLI: ingests the media directly, emits segments[] JSON. */
async function transcribeWithOpenAI(
  mediaPath: string,
  outDir: string,
  timeoutMs: number,
): Promise<TranscriptSegment[] | null> {
  await runProc(
    OPENAI_CMD,
    [
      mediaPath,
      "--model", OPENAI_MODEL,
      "--output_format", "json",
      "--output_dir", outDir,
      "--language", "en",
      "--fp16", "False",
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

/** True if the binary can be spawned (resolves regardless of exit code). */
function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ["--help"], { stdio: "ignore" });
    child.on("error", () => resolve(false)); // ENOENT — not installed
    child.on("close", () => resolve(true));
    setTimeout(() => { child.kill("SIGKILL"); resolve(true); }, 15_000);
  });
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
