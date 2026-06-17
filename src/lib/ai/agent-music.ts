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
          // Archive the ORIGINAL (untrimmed) track into our permanent library so
          // it's reusable at any duration and feeds the curated fallback over time.
          // Best-effort — never blocks the reel.
          await archiveToMusicLibrary(mp3Path, input.musicMood, input.musicTempo).catch(() => {});

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

  const prompt = `You are a music researcher. Your task is to find and download ONE royalty-free music track from Pixabay using ONLY command-line tools (curl/wget). Do this entirely in the shell.

ABSOLUTE RULE — NO BROWSER:
- Do NOT open or use a web browser, Chrome, Chromium, Playwright, Puppeteer, the browser tool, or any GUI/headless browser. None of that is allowed or needed.
- Use ONLY shell commands: curl (or wget) to fetch HTML and download files. Parse HTML with grep/sed/python from the command line.

STEPS (all via shell):
1. Fetch the search page HTML with curl (send a normal browser User-Agent header):
   curl -sL -A "Mozilla/5.0" "https://pixabay.com/music/search/${encodeURIComponent(keywords)}/" -o search.html
2. Extract a direct .mp3 CDN URL from search.html (Pixabay serves audio from cdn.pixabay.com / *.pixabay.com; grep for "https" + ".mp3").
3. Pick a track that is instrumental (no vocals preferred) and at least 30 seconds.
4. Download the actual MP3 (not a preview) with curl to: ${downloadPath}
   curl -sL -A "Mozilla/5.0" "<mp3-url>" -o "${downloadPath}"

OUTPUT: Write ONLY the filename of the downloaded track (or "FAILED" if you could not download anything via the command line).

IMPORTANT:
- Pixabay music is free for commercial use, no attribution required.
- If you cannot extract a usable URL from the HTML, output "FAILED" — do NOT fall back to a browser.`;

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
      // Hard-disable the browser/Chrome plugins so Codex cannot launch a GUI/headless
      // browser for this task — it must use curl/wget in the shell instead.
      "-c", `'plugins."browser@openai-bundled".enabled=false'`,
      "-c", `'plugins."chrome@openai-bundled".enabled=false'`,
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

/** Max tracks kept per mood folder before least-frequently-used eviction. */
const MAX_PER_MOOD = Number(process.env.MUSIC_LIBRARY_MAX_PER_MOOD ?? 15);

/** Pick the single mood folder a discovered track should be filed under. */
function primaryMoodFolder(musicMood: string[], tempo: string): string {
  for (const m of musicMood) {
    const mapped = MOOD_MAPPING[m.toLowerCase()];
    if (mapped?.length) return mapped[0];
  }
  const t = MOOD_MAPPING[tempo];
  if (t?.length) return t[0];
  return "inspirational";
}

let libraryBucketEnsured = false;

/**
 * Archive a discovered track into the permanent `music-library`.
 *
 * - Dedupes by content hash (same track is never stored twice; re-hits just bump usage).
 * - Bounds storage: each mood folder keeps at most MAX_PER_MOOD tracks, evicting the
 *   least-frequently-used (then oldest) when full.
 * Best-effort: any failure is logged and swallowed so the reel pipeline is unaffected.
 */
async function archiveToMusicLibrary(
  originalPath: string,
  musicMood: string[],
  tempo: string,
): Promise<void> {
  try {
    const buf = await fs.readFile(originalPath);
    if (buf.length < 10_000) return; // too small to be a real track

    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    const code = hash.slice(0, 12);

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    // music_library is newer than the generated Database types — permissive accessor.
    const db = admin as unknown as { from: (table: string) => any };

    // Dedupe — already catalogued? Bump usage and stop.
    const { data: existing } = await db
      .from("music_library")
      .select("id, times_used")
      .eq("content_hash", hash)
      .maybeSingle();
    if (existing) {
      await db
        .from("music_library")
        .update({ times_used: (existing.times_used ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", existing.id);
      console.log(`[Music] Library: track ${code} already archived — usage bumped`);
      return;
    }

    const mood = primaryMoodFolder(musicMood, tempo);

    // Enforce the per-mood cap with least-frequently-used eviction.
    const { data: moodRows } = await db
      .from("music_library")
      .select("id, storage_path, times_used, last_used_at")
      .eq("mood", mood)
      .order("times_used", { ascending: true })
      .order("last_used_at", { ascending: true });
    if (moodRows && moodRows.length >= MAX_PER_MOOD) {
      const victims = moodRows.slice(0, moodRows.length - MAX_PER_MOOD + 1);
      for (const v of victims) {
        await admin.storage.from("music-library").remove([v.storage_path]).catch(() => {});
        await db.from("music_library").delete().eq("id", v.id);
      }
      console.log(`[Music] Library: mood "${mood}" at cap (${MAX_PER_MOOD}) — evicted ${victims.length} least-used`);
    }

    // Ensure the bucket exists (idempotent; "already exists" errors are ignored).
    if (!libraryBucketEnsured) {
      await admin.storage.createBucket("music-library", { public: false }).catch(() => {});
      libraryBucketEnsured = true;
    }
    const storagePath = `${mood}/${code}.mp3`;
    const { error: upErr } = await admin.storage
      .from("music-library")
      .upload(storagePath, buf, { contentType: "audio/mpeg", upsert: true });
    if (upErr) {
      console.warn(`[Music] Library upload failed: ${upErr.message}`);
      return;
    }

    await db.from("music_library").insert({
      code,
      content_hash: hash,
      storage_path: storagePath,
      mood,
      mood_keywords: musicMood,
      tempo,
      source: "pixabay",
      file_size: buf.length,
    });
    console.log(`[Music] Library: archived new track ${code} → ${storagePath} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.warn(`[Music] Library archive skipped: ${err instanceof Error ? err.message : err}`);
  }
}

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

    // Bump usage stats so least-frequently-used eviction reflects fallback picks too.
    const db = admin as unknown as { from: (table: string) => any };
    const code = picked.name.replace(/\.mp3$/i, "");
    const { data: row } = await db
      .from("music_library")
      .select("id, times_used")
      .eq("code", code)
      .maybeSingle();
    if (row) {
      await db
        .from("music_library")
        .update({ times_used: (row.times_used ?? 0) + 1, last_used_at: new Date().toISOString() })
        .eq("id", row.id)
        .then(() => {}, () => {});
    }

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
