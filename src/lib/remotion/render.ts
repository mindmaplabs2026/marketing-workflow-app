/**
 * Remotion Render Orchestrator — spawns the standalone remotion-renderer
 * as a subprocess, identical to how codex-text.ts spawns `codex exec`.
 *
 * The remotion-renderer project lives at REMOTION_RENDERER_DIR (sibling to
 * marketing-workflow-app). It has its own node_modules with all Remotion
 * packages — nothing Remotion-related is in the Next.js app.
 *
 * Flow:
 *   1. Caller provides AI-generated Reel.tsx + data.ts code strings
 *   2. This module creates a temp work directory with all required files
 *   3. Downloads media from Supabase Storage to work dir
 *   4. Spawns `node --import tsx render.ts <workDir>` in the renderer project
 *   5. Returns the path to the rendered MP4
 *   6. Caller uploads MP4 to Supabase, then calls cleanup()
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

/**
 * Render an AI-generated Remotion composition to MP4.
 *
 * Throws on failure (compilation error, render error, timeout).
 */
export async function renderReel(input: RenderInput): Promise<RenderResult> {
  const timeoutMs = input.timeoutMs ?? 600_000; // 10 minutes
  const workDir = path.join(
    os.tmpdir(),
    "remotion-render",
    `${process.pid}-${Date.now()}`,
  );
  await fs.mkdir(workDir, { recursive: true });

  const scaffoldDir = path.join(REMOTION_RENDERER_DIR, "scaffold");
  const startTime = Date.now();

  try {
    // 1. Copy scaffold files
    await fs.copyFile(
      path.join(scaffoldDir, "index.template.ts"),
      path.join(workDir, "index.ts"),
    );
    await fs.copyFile(
      path.join(scaffoldDir, "Root.template.tsx"),
      path.join(workDir, "Root.tsx"),
    );
    await fs.copyFile(
      path.join(scaffoldDir, "helpers.ts"),
      path.join(workDir, "helpers.ts"),
    );

    // 2. Write AI-generated code
    await fs.writeFile(path.join(workDir, "Reel.tsx"), input.reelTsx);
    if (input.dataTsx) {
      await fs.writeFile(path.join(workDir, "data.ts"), input.dataTsx);
    }

    // 3. Write media files
    const mediaDir = path.join(workDir, "media");
    await fs.mkdir(mediaDir, { recursive: true });
    for (const [name, buffer] of input.mediaFiles) {
      await fs.writeFile(path.join(mediaDir, name), buffer);
    }

    // 4. Write music file
    if (input.musicFile) {
      const musicDir = path.join(workDir, "music");
      await fs.mkdir(musicDir, { recursive: true });
      await fs.writeFile(
        path.join(musicDir, input.musicFile.name),
        input.musicFile.buffer,
      );
    }

    // 5. Write tsconfig for the work dir (needed by tsx loader)
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

    // 6. Spawn the renderer
    console.log(`[remotion-render] Spawning renderer for ${workDir}`);
    await spawnRenderer(workDir, timeoutMs);

    const outputPath = path.join(workDir, "output.mp4");
    if (
      !(await fs
        .stat(outputPath)
        .then(() => true)
        .catch(() => false))
    ) {
      throw new Error("Render completed but output.mp4 not found");
    }

    const renderTimeSec = (Date.now() - startTime) / 1000;
    console.log(
      `[remotion-render] Success in ${renderTimeSec.toFixed(1)}s — ${outputPath}`,
    );

    return {
      outputPath,
      workDir,
      renderTimeSec,
      cleanup: () => fs.rm(workDir, { recursive: true, force: true }),
    };
  } catch (err) {
    // Cleanup on failure
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
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
      // Forward render logs to parent's console
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
      reject(
        new Error(`Failed to spawn renderer: ${err.message}`),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Remotion render exited with code ${code}: ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });
  });
}
