import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Subset of the Jamendo /tracks API row we read. */
type JamendoTrack = {
  id?: number | string;
  name?: string;
  artist_name?: string;
  duration?: number | string;
  audiodownload?: string;
  license_ccurl?: string;
  shareurl?: string;
  shorturl?: string;
  musicinfo?: { vocalinstrumental?: string };
};

/** Attribution + license info for a discovered track (Creative Commons). */
export type MusicAttribution = {
  artist?: string;
  title?: string;
  /** License URL (e.g. the CC license deed) — needed when crediting. */
  licenseUrl?: string;
  /** Track page URL on the source. */
  trackUrl?: string;
  source: string;
};

export type MusicResult = {
  /** Buffer of the trimmed MP3 file. */
  buffer: Buffer;
  /** Filename for the trimmed track. */
  filename: string;
  /** Source: "jamendo", "curated-library", or "fallback-silent". */
  source: string;
  /** Original track info (artist — title, if from Jamendo). */
  trackInfo?: string;
  /** Attribution/license metadata for crediting (CC tracks usually require it). */
  attribution?: MusicAttribution;
  /** Stable identity of the chosen track (e.g. Jamendo id), for cross-variation
   *  dedup so two variations in the same job don't get the same audio. */
  trackKey?: string;
};

/**
 * Find and download a royalty-free music track matching the reel's mood,
 * then trim it to the target duration with ffmpeg fade-in/out.
 *
 * Strategy:
 *   1. Query the Jamendo API (official REST/JSON) for a Creative-Commons track
 *      matching the mood keywords, and download its direct MP3 URL.
 *   2. Trim with ffmpeg: exact duration + 0.5s fade-in + 2s fade-out.
 *
 * (We previously scraped Pixabay via `curl`, but Pixabay sits behind a Cloudflare
 * bot challenge — curl gets a 403 "Just a moment..." page with no audio URLs, so
 * it failed 100% of the time. Jamendo exposes a real JSON API with direct
 * `audiodownload` MP3 links and no bot wall, so plain Node fetch works headless.)
 *
 * If Jamendo discovery fails after retries, falls back to a curated local library,
 * then to a silent track.
 */
export async function findAndTrimMusic(input: {
  musicMood: string[];
  musicTempo: "slow" | "moderate" | "fast";
  durationSec: number;
  timeoutMs?: number;
  /** Track keys (Jamendo ids) already used by sibling variations in this job —
   *  skipped so each variation gets DIFFERENT audio. */
  excludeKeys?: Set<string>;
}): Promise<MusicResult> {
  const workDir = path.join(os.tmpdir(), "reel-music", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Try Jamendo discovery up to 3 times with broadening keywords
    const keywordSets = [
      input.musicMood.join(" "),
      input.musicMood.slice(0, 2).join(" "),
      input.musicTempo === "fast" ? "upbeat energetic" : input.musicTempo === "slow" ? "calm ambient" : "background music",
    ];

    for (let attempt = 0; attempt < keywordSets.length; attempt++) {
      const keywords = keywordSets[attempt];
      console.log(`[Music] Attempt ${attempt + 1}/3: searching Jamendo for "${keywords}"`);

      try {
        const found = await discoverFromJamendo(keywords, input.durationSec, workDir, input.timeoutMs ?? 60_000, input.excludeKeys);
        if (found) {
          // Archive the ORIGINAL (untrimmed) track into our permanent library so
          // it's reusable at any duration and feeds the curated fallback over time.
          // Best-effort — never blocks the reel.
          await archiveToMusicLibrary(found.mp3Path, input.musicMood, input.musicTempo).catch(() => {});

          const trimmedPath = await trimWithFfmpeg(found.mp3Path, input.durationSec, workDir);
          const buffer = await fs.readFile(trimmedPath);
          console.log(`[Music] Success — Jamendo track "${found.trackInfo}" trimmed to ${input.durationSec}s (${(buffer.length / 1024).toFixed(0)} KB)`);
          return {
            buffer,
            filename: "track.mp3",
            source: "jamendo",
            trackInfo: found.trackInfo,
            attribution: found.attribution,
            trackKey: found.trackKey,
          };
        }
      } catch (err) {
        console.warn(`[Music] Jamendo attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Fallback: try curated library from Supabase Storage
    console.warn("[Music] All Jamendo attempts failed — trying curated library");
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
 * Discover a royalty-free track from the Jamendo API and download its MP3.
 *
 * Jamendo exposes an official JSON API (no Cloudflare bot wall), so this is a
 * plain Node fetch — no Codex/browser needed. Requires a free client_id in the
 * JAMENDO_CLIENT_ID env var (register at https://devportal.jamendo.com/).
 *
 * Returns the local MP3 path + a human-readable "artist — title", or null.
 */
async function discoverFromJamendo(
  keywords: string,
  durationSec: number,
  workDir: string,
  timeoutMs: number,
  excludeKeys?: Set<string>,
): Promise<{ mp3Path: string; trackInfo: string; attribution: MusicAttribution; trackKey: string } | null> {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) {
    console.warn("[Music] JAMENDO_CLIENT_ID not set — skipping Jamendo discovery");
    return null;
  }

  const downloadPath = path.join(workDir, "downloaded.mp3");
  const tags = encodeURIComponent(keywords.trim().replace(/\s+/g, "+"));
  // mp32 = full 320kbps MP3; audiodownload_allowed=true ensures the track is
  // legally downloadable; order by popularity for quality; fuzzytags matches mood.
  const apiUrl =
    `https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}` +
    `&format=json&limit=20&fuzzytags=${tags}` +
    `&audioformat=mp32&audiodownload_allowed=true&include=musicinfo+licenses&order=popularity_total`;

  // Pull the candidate list from the JSON API.
  const listJson = await fetchWithTimeout(apiUrl, timeoutMs).then((r) => r.json());
  if (listJson?.headers?.status !== "success") {
    console.warn(`[Music] Jamendo API error: ${listJson?.headers?.error_message ?? "unknown"}`);
    return null;
  }
  const results: JamendoTrack[] = Array.isArray(listJson.results) ? listJson.results : [];
  if (results.length === 0) return null;

  // Prefer instrumental tracks at least as long as the reel; otherwise take the
  // longest available so ffmpeg has enough material to trim to durationSec.
  const isInstrumental = (t: JamendoTrack) =>
    String(t?.musicinfo?.vocalinstrumental ?? "").toLowerCase() === "instrumental";
  const longEnough = results.filter((t) => Number(t.duration) >= durationSec);
  const pool = longEnough.length ? longEnough : results;
  pool.sort((a, b) => {
    const ai = isInstrumental(a) ? 0 : 1;
    const bi = isInstrumental(b) ? 0 : 1;
    if (ai !== bi) return ai - bi; // instrumental first
    return Number(b.duration) - Number(a.duration); // then longest
  });

  // Skip tracks already used by sibling variations so each variation gets
  // DIFFERENT audio (popular tracks otherwise win every keyword set). Scan deeper
  // than the top 5 since exclusions may knock out the most-popular picks.
  const trackKeyOf = (t: JamendoTrack) => String(t.id ?? t.audiodownload ?? `${t.artist_name}-${t.name}`);
  const candidates = pool.filter((t) => !excludeKeys?.has(trackKeyOf(t)));
  if (candidates.length === 0) {
    console.warn(`[Music] All Jamendo matches for "${keywords}" already used by sibling variations — no fresh track`);
    return null;
  }

  // Download the first fresh candidate that yields a real MP3.
  for (const track of candidates.slice(0, 8)) {
    const dlUrl: string | undefined = track.audiodownload;
    if (!dlUrl) continue;
    try {
      const res = await fetchWithTimeout(dlUrl, timeoutMs);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) continue; // too small to be a real track
      await fs.writeFile(downloadPath, buf);
      const trackInfo = `${track.artist_name ?? "Unknown"} — ${track.name ?? "Untitled"}`;
      const attribution: MusicAttribution = {
        artist: track.artist_name ?? undefined,
        title: track.name ?? undefined,
        licenseUrl: track.license_ccurl ?? undefined,
        trackUrl: track.shareurl ?? track.shorturl ?? undefined,
        source: "jamendo",
      };
      console.log(`[Music] Jamendo downloaded "${trackInfo}" (${(buf.length / 1024).toFixed(0)} KB, ${track.duration}s)`);
      return { mp3Path: downloadPath, trackInfo, attribution, trackKey: trackKeyOf(track) };
    } catch (err) {
      console.warn(`[Music] Jamendo download failed for "${track.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return null;
}

/** fetch() with an AbortController timeout and a browser-ish User-Agent. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "marketing-workflow-app/1.0 (+reel-music)" },
    });
  } finally {
    clearTimeout(timer);
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
 * Each mood folder contains 2-3 royalty-free tracks archived from Jamendo discovery.
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
      source: "jamendo",
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
