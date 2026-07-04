/**
 * Remotion Render Orchestrator — spawns the standalone remotion-renderer
 * as a subprocess, identical to how codex-text.ts spawns `codex exec`.
 *
 * The remotion-renderer project lives at REMOTION_RENDERER_DIR (sibling to
 * marketing-workflow-app). It has its own node_modules with all Remotion
 * packages — nothing Remotion-related is in the Next.js app.
 *
 * Two render paths, sharing finalizeRender() (media placement + spawn + faststart):
 *   • renderReel     — free-form AI Reel.tsx (legacy / advanced path)
 *   • renderReelDoc  — structured ReelDoc rendered by the fixed SchemaReel (Tier 2)
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReelDoc } from "@/lib/ai/reel-doc";

const REMOTION_RENDERER_DIR =
  process.env.REMOTION_RENDERER_DIR ??
  path.resolve(__dirname, "../../../../remotion-renderer");

export type RenderInput = {
  /** AI-generated Reel.tsx source code. */
  reelTsx: string;
  /** AI-generated data.ts source code (optional — can be inlined in Reel.tsx). */
  dataTsx?: string;
  /** Media files to place in work dir. Key = filename, value = Buffer. */
  mediaFiles: Map<string, Buffer>;
  /** Trimmed music track. Key = filename, value = Buffer. */
  musicFile?: { name: string; buffer: Buffer };
  /** Timeout in ms (default: 10 minutes). */
  timeoutMs?: number;
};

export type RenderDocInput = {
  /** Validated structured scene graph. */
  doc: ReelDoc;
  mediaFiles: Map<string, Buffer>;
  musicFile?: { name: string; buffer: Buffer };
  timeoutMs?: number;
};

export type RenderResult = {
  /** Absolute path to the rendered MP4. */
  outputPath: string;
  /** Work directory (caller must call cleanup after uploading). */
  workDir: string;
  /** Render wall-time in seconds. */
  renderTimeSec: number;
  /** Cleanup function — removes the work directory. */
  cleanup: () => Promise<void>;
};

function newWorkDir(): string {
  return path.join(os.tmpdir(), "remotion-render", `${process.pid}-${Date.now()}`);
}

/** Remove the workdir + the media/music we staged in the renderer's public/ dir. */
async function cleanupStaged(workDir: string): Promise<void> {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(REMOTION_RENDERER_DIR, "public", "media"), { recursive: true, force: true }).catch(() => {});
  await fs.rm(path.join(REMOTION_RENDERER_DIR, "public", "music"), { recursive: true, force: true }).catch(() => {});
}

/**
 * Render a free-form AI-generated Remotion composition to MP4.
 * Throws on failure (compilation error, render error, timeout).
 */
export async function renderReel(input: RenderInput): Promise<RenderResult> {
  const timeoutMs = input.timeoutMs ?? 600_000; // 10 minutes
  const workDir = newWorkDir();
  await fs.mkdir(workDir, { recursive: true });
  const scaffoldDir = path.join(REMOTION_RENDERER_DIR, "scaffold");
  const startTime = Date.now();

  try {
    // Scaffold + AI-generated code
    await fs.copyFile(path.join(scaffoldDir, "index.template.ts"), path.join(workDir, "index.ts"));
    await fs.copyFile(path.join(scaffoldDir, "Root.template.tsx"), path.join(workDir, "Root.tsx"));
    await fs.copyFile(path.join(scaffoldDir, "helpers.ts"), path.join(workDir, "helpers.ts"));
    await fs.writeFile(path.join(workDir, "Reel.tsx"), input.reelTsx);
    if (input.dataTsx) await fs.writeFile(path.join(workDir, "data.ts"), input.dataTsx);

    return await finalizeRender(workDir, input.mediaFiles, input.musicFile, timeoutMs, startTime);
  } catch (err) {
    await cleanupStaged(workDir);
    throw err;
  }
}

const SCHEMA_REEL_TSX = `import React from "react";
import { SchemaReel } from "./SchemaReel";
import { computeDurationInFrames } from "./reelDoc";
import { doc } from "./doc";

export const REEL_DURATION = computeDurationInFrames(doc);
export const Reel: React.FC = () => <SchemaReel doc={doc} />;
`;

const SCHEMA_ROOT_TSX = `import { Composition } from "remotion";
import { Reel, REEL_DURATION } from "./Reel";
import { doc } from "./doc";

export const RemotionRoot: React.FC = () => (
  <Composition id="reel" component={Reel} durationInFrames={REEL_DURATION} fps={doc.fps} width={doc.width} height={doc.height} />
);
`;

const SCHEMA_INDEX_TS = `import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
`;

/**
 * Render a structured ReelDoc to MP4 via the FIXED SchemaReel renderer. The doc is
 * written as doc.ts and the renderer's schema files (SchemaReel.tsx, reelDoc.ts,
 * fonts.ts) are copied into the workdir — no AI code is compiled, so this can't fail
 * on a syntax error the way the free-form path can.
 */
export async function renderReelDoc(input: RenderDocInput): Promise<RenderResult> {
  const timeoutMs = input.timeoutMs ?? 600_000;
  const workDir = newWorkDir();
  await fs.mkdir(workDir, { recursive: true });
  const schemaDir = path.join(REMOTION_RENDERER_DIR, "schema");
  const startTime = Date.now();

  try {
    // Copy the fixed renderer modules into the workdir so relative imports resolve.
    for (const f of ["SchemaReel.tsx", "reelDoc.ts", "fonts.ts"]) {
      await fs.copyFile(path.join(schemaDir, f), path.join(workDir, f));
    }
    await fs.writeFile(
      path.join(workDir, "doc.ts"),
      `import type { ReelDoc } from "./reelDoc";\nexport const doc: ReelDoc = ${JSON.stringify(input.doc, null, 2)};\n`,
    );
    await fs.writeFile(path.join(workDir, "Reel.tsx"), SCHEMA_REEL_TSX);
    await fs.writeFile(path.join(workDir, "Root.tsx"), SCHEMA_ROOT_TSX);
    await fs.writeFile(path.join(workDir, "index.ts"), SCHEMA_INDEX_TS);

    return await finalizeRender(workDir, input.mediaFiles, input.musicFile, timeoutMs, startTime);
  } catch (err) {
    await cleanupStaged(workDir);
    throw err;
  }
}

/**
 * Shared tail for both render paths: stage media/music into the renderer's public/,
 * write the workdir tsconfig, spawn the renderer, then remux for faststart. Returns
 * the RenderResult (its cleanup removes the workdir + staged public assets).
 */
async function finalizeRender(
  workDir: string,
  mediaFiles: Map<string, Buffer>,
  musicFile: { name: string; buffer: Buffer } | undefined,
  timeoutMs: number,
  startTime: number,
): Promise<RenderResult> {
  // Media/music go in remotion-renderer/public/ — Remotion resolves staticFile()
  // relative to the project's public/ folder, not the workDir. Worker is
  // single-threaded, so no concurrent-access conflicts.
  const publicDir = path.join(REMOTION_RENDERER_DIR, "public");
  const mediaDir = path.join(publicDir, "media");
  const musicDir = path.join(publicDir, "music");
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(musicDir, { recursive: true });

  for (const [name, buffer] of mediaFiles) {
    await fs.writeFile(path.join(mediaDir, name), buffer);
  }
  if (musicFile) {
    await fs.writeFile(path.join(musicDir, musicFile.name), musicFile.buffer);
  }

  // tsconfig for the tsx loader in the workdir
  await fs.writeFile(
    path.join(workDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    }),
  );

  console.log(`[remotion-render] Spawning renderer for ${workDir}`);
  await spawnRenderer(workDir, timeoutMs);

  const rawPath = path.join(workDir, "output.mp4");
  if (!(await fs.stat(rawPath).then(() => true).catch(() => false))) {
    throw new Error("Render completed but output.mp4 not found");
  }

  const rawSizeMb = (await fs.stat(rawPath)).size / 1024 / 1024;
  const renderTimeSec = (Date.now() - startTime) / 1000;
  console.log(`[remotion-render] Rendered in ${renderTimeSec.toFixed(1)}s — ${rawSizeMb.toFixed(1)} MB (raw)`);

  // Remux (stream copy) to move the moov atom to the front for instant web playback.
  // The renderer already encoded h264 at the target CRF, so NO re-encode here.
  const compressedPath = path.join(workDir, "output-faststart.mp4");
  console.log(`[remotion-render] Remuxing for faststart (stream copy, no re-encode)...`);
  const compressStart = Date.now();

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", rawPath,
      "-c", "copy",
      "-movflags", "+faststart",
      "-y", compressedPath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code: number | null) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg remux exit ${code}: ${stderr.slice(0, 300)}`));
    });
    child.on("error", reject);
    setTimeout(() => { child.kill(); reject(new Error("ffmpeg remux timeout")); }, 60000);
  });

  const compressedSizeMb = (await fs.stat(compressedPath)).size / 1024 / 1024;
  const compressSec = ((Date.now() - compressStart) / 1000).toFixed(1);
  console.log(`[remotion-render] Faststart remux in ${compressSec}s: ${compressedSizeMb.toFixed(1)} MB (rendered at target quality, no re-encode)`);

  return {
    outputPath: compressedPath,
    workDir,
    renderTimeSec,
    cleanup: () => cleanupStaged(workDir),
  };
}

/**
 * Pull the meaningful compile/render error out of the renderer's output so it
 * can be fed back to Codex for self-correction. Remotion/webpack print the root
 * cause near the FIRST "error"; the noise above it (font/objectFit warnings) is
 * irrelevant. Falls back to the tail if no "error" token is present.
 */
function extractRenderError(stdout: string, stderr: string): string {
  const combined = `${stderr}\n${stdout}`.trim();
  const idx = combined.toLowerCase().indexOf("error");
  const slice =
    idx >= 0
      ? combined.slice(Math.max(0, idx - 80), idx - 80 + 1800)
      : combined.slice(-1800);
  return slice.trim() || "(no renderer output)";
}

function spawnRenderer(workDir: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const renderScript = path.join(REMOTION_RENDERER_DIR, "render.ts");

    // Use shell mode with a command string — prevents Turbopack from
    // analyzing spawn arguments and treating "--import" as a module specifier.
    const cmd = `node --import tsx "${renderScript}" "${workDir}"`;
    const child = spawn(cmd, [], {
      cwd: REMOTION_RENDERER_DIR,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const line = d.toString();
      stdout += line;
      process.stdout.write(`[remotion] ${line}`);
    });
    child.stderr.on("data", (d) => {
      const line = d.toString();
      stderr += line;
      process.stderr.write(`[remotion-err] ${line}`);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Remotion render timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn renderer: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Remotion render exited with code ${code}: ${extractRenderError(stdout, stderr)}`));
      }
    });
  });
}
