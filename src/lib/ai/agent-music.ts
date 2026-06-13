import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type MusicResult = {
  /** Buffer of the trimmed MP3 file. */
  buffer: Buffer;
  /** Filename for the trimmed track. */
  filename: string;
  /** Source: "pixabay" or "fallback-library". */
  source: string;
  /** Original track info (if Pixabay). */
  trackInfo?: string;
};

/**
 * Find and download a royalty-free music track matching the reel's mood,
 * then trim it to the target duration with ffmpeg fade-in/out.
 *
 * Strategy:
 *   1. Use Codex to browse Pixabay's music search page and extract a download URL.
 *   2. Download the MP3.
 *   3. Trim with ffmpeg: exact duration + 0.5s fade-in + 2s fade-out.
 *
 * If Pixabay discovery fails after retries, falls back to a curated local library.
 */
export async function findAndTrimMusic(input: {
  musicMood: string[];
  musicTempo: "slow" | "moderate" | "fast";
  durationSec: number;
  timeoutMs?: number;
}): Promise<MusicResult> {
  const workDir = path.join(os.tmpdir(), "reel-music", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Try Pixabay discovery up to 3 times with broadening keywords
    const keywordSets = [
      input.musicMood.join(" "),
      input.musicMood.slice(0, 2).join(" "),
      input.musicTempo === "fast" ? "upbeat energetic" : input.musicTempo === "slow" ? "calm ambient" : "background music",
    ];

    for (let attempt = 0; attempt < keywordSets.length; attempt++) {
      const keywords = keywordSets[attempt];
      console.log(`[Music] Attempt ${attempt + 1}/3: searching Pixabay for "${keywords}"`);

      try {
        const mp3Path = await discoverFromPixabay(keywords, workDir, input.timeoutMs ?? 120_000);
        if (mp3Path) {
          const trimmedPath = await trimWithFfmpeg(mp3Path, input.durationSec, workDir);
          const buffer = await fs.readFile(trimmedPath);
          console.log(`[Music] Success — Pixabay track trimmed to ${input.durationSec}s (${(buffer.length / 1024).toFixed(0)} KB)`);
          return {
            buffer,
            filename: "track.mp3",
            source: "pixabay",
            trackInfo: keywords,
          };
        }
      } catch (err) {
        console.warn(`[Music] Pixabay attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Fallback: try curated library from Supabase Storage
    console.warn("[Music] All Pixabay attempts failed — trying curated library");
    try {
      const fallbackResult = await pickFromCuratedLibrary(input.musicMood, input.musicTempo, input.durationSec, workDir);
      if (fallbackResult) return fallbackResult;
    } catch (err) {
      console.warn(`[Music] Curated library fallback failed: ${err instanceof Error ? err.message : err}`);
    }

    // Last resort: generate a silent track with ffmpeg
    console.warn("[Music] All fallbacks exhausted — generating silent track");
    const silentPath = path.join(workDir, "silent.mp3");
    await runCommand("ffmpeg", [
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", String(input.durationSec),
      "-q:a", "9",
      silentPath,
    ], workDir, 30_000);
    const buffer = await fs.readFile(silentPath);
    return { buffer, filename: "track.mp3", source: "fallback-silent" };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Use Codex to browse Pixabay music search and download a track.
 * Returns the local path to the downloaded MP3, or null if not found.
 */
async function discoverFromPixabay(
  keywords: string,
  workDir: string,
  timeoutMs: number,
): Promise<string | null> {
  const outFile = path.join(workDir, "codex-music-output.txt");
  const downloadPath = path.join(workDir, "downloaded.mp3");

  const prompt = `You are a music researcher. Your task is to find and download ONE royalty-free music track from Pixabay.

STEPS:
1. Go to https://pixabay.com/music/search/${encodeURIComponent(keywords)}/
2. Find a track that:
   - Is at least 30 seconds long
   - Matches the mood: ${keywords}
   - Is instrumental (no vocals preferred)
3. Get the direct download URL for the MP3 file
4. Download it to: ${downloadPath}

OUTPUT: Write ONLY the filename of the downloaded track (or "FAILED" if you could not download anything).

IMPORTANT:
- Pixabay music is free for commercial use, no attribution required
- Download the actual MP3 file, not a preview
- If the page structure blocks direct download, try alternative search terms or pages`;

  try {
    await runCodexExec(prompt, outFile, workDir, timeoutMs);

    // Check if the file was downloaded
    const exists = await fs.stat(downloadPath).then(() => true).catch(() => false);
    if (exists) {
      const size = (await fs.stat(downloadPath)).size;
      if (size > 10_000) { // >10KB = real MP3
        console.log(`[Music] Codex downloaded ${(size / 1024).toFixed(0)} KB MP3`);
        return downloadPath;
      }
    }

    // Check codex output for any alternative path
    const output = await fs.readFile(outFile, "utf8").catch(() => "");
    console.log(`[Music] Codex output: ${output.slice(0, 200)}`);
    return null;
  } catch {
    return null;
  }
}

/** Trim an MP3 to exact duration with fade-in/out using ffmpeg. */
async function trimWithFfmpeg(
  inputPath: string,
  durationSec: number,
  workDir: string,
): Promise<string> {
  const outputPath = path.join(workDir, "trimmed.mp3");
  const fadeOutStart = Math.max(0, durationSec - 2);

  await runCommand("ffmpeg", [
    "-i", inputPath,
    "-t", String(durationSec),
    "-af", `afade=t=in:d=0.5,afade=t=out:st=${fadeOutStart}:d=2`,
    "-y",
    outputPath,
  ], workDir, 30_000);

  return outputPath;
}

/** Spawn codex exec with a prompt on stdin, capturing output to a file. */
function runCodexExec(
  prompt: string,
  outFile: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C", `"${cwd}"`,
      "-o", `"${outFile}"`,
      "-",
    ];

    const child = spawn("codex", args, { cwd, shell: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {}); // drain
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec (music) timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exec (music) exited ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Curated music library — tracks stored in Supabase Storage `music-library` bucket.
 *
 * Expected structure:
 *   music-library/
 *     upbeat/track1.mp3
 *     calm/track1.mp3
 *     celebratory/track1.mp3
 *     inspirational/track1.mp3
 *     ambient/track1.mp3
 *
 * Each mood folder contains 2-3 royalty-free tracks pre-downloaded from Pixabay.
 */
const MOOD_MAPPING: Record<string, string[]> = {
  // Map common mood keywords to curated folder names
  upbeat: ["upbeat", "celebratory"],
  energetic: ["upbeat"],
  happy: ["upbeat", "celebratory"],
  fast: ["upbeat"],
  calm: ["calm", "ambient"],
  peaceful: ["calm"],
  reflective: ["calm", "inspirational"],
  slow: ["calm", "ambient"],
  warm: ["inspirational", "calm"],
  acoustic: ["inspirational"],
  inspirational: ["inspirational"],
  celebratory: ["celebratory", "upbeat"],
  school: ["inspirational", "upbeat"],
  ambient: ["ambient", "calm"],
  moderate: ["inspirational"],
};

async function pickFromCuratedLibrary(
  musicMood: string[],
  musicTempo: "slow" | "moderate" | "fast",
  durationSec: number,
  workDir: string,
): Promise<MusicResult | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  // Find the best matching folder
  const candidates = new Set<string>();
  for (const mood of musicMood) {
    const mapped = MOOD_MAPPING[mood.toLowerCase()];
    if (mapped) mapped.forEach((f) => candidates.add(f));
  }
  // Also map by tempo
  const tempoMapped = MOOD_MAPPING[musicTempo];
  if (tempoMapped) tempoMapped.forEach((f) => candidates.add(f));

  // Default if nothing matches
  if (candidates.size === 0) candidates.add("inspirational");

  // Try each candidate folder
  for (const folder of candidates) {
    const { data: files } = await admin.storage
      .from("music-library")
      .list(folder, { limit: 10 });

    if (!files || files.length === 0) continue;

    // Pick a random track from the folder
    const mp3Files = files.filter((f) => f.name.endsWith(".mp3"));
    if (mp3Files.length === 0) continue;

    const picked = mp3Files[Math.floor(Math.random() * mp3Files.length)];
    const storagePath = `${folder}/${picked.name}`;

    console.log(`[Music] Curated library: downloading ${storagePath}`);
    const { data: fileData } = await admin.storage
      .from("music-library")
      .download(storagePath);

    if (!fileData) continue;

    const mp3Path = path.join(workDir, "curated.mp3");
    await fs.writeFile(mp3Path, Buffer.from(await fileData.arrayBuffer()));

    const trimmedPath = await trimWithFfmpeg(mp3Path, durationSec, workDir);
    const buffer = await fs.readFile(trimmedPath);

    console.log(`[Music] Curated library success: ${storagePath} trimmed to ${durationSec}s (${(buffer.length / 1024).toFixed(0)} KB)`);
    return {
      buffer,
      filename: "track.mp3",
      source: "curated-library",
      trackInfo: `${folder}/${picked.name}`,
    };
  }

  return null;
}

/**
 * Check if ffmpeg is available on the system. Called at worker startup.
 */
export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-version"], { stdio: ["ignore", "pipe", "pipe"] });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
      child.stdout.on("data", () => {});
      child.stderr.on("data", () => {});
    });
    return true;
  } catch {
    return false;
  }
}

/** Run a shell command and wait for completion. */
function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });
}
