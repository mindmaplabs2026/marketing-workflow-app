/**
 * Codex Poster Bridge — Phase 5: drive Codex's BUILT-IN image tool from Node.
 *
 * The image generation/edit runs on the ChatGPT subscription (no API key) by
 * shelling out to `codex exec`. Codex's built-in image tool always writes its
 * output under $CODEX_HOME/generated_images/<id>/..., so the most reliable way
 * to capture the result is to note the time before the run and then read the
 * newest file created there afterwards.
 *
 * generate: text → image.   edit: reference images (-i) + text → image.
 *
 * NOTE: uses --dangerously-bypass-approvals-and-sandbox so the non-interactive
 * run never blocks on a prompt. For production (Phase 6) we can tighten the
 * sandbox; on the trusted worker box this is acceptable.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function codexHome(): string {
  return process.env.CODEX_HOME && process.env.CODEX_HOME.trim().length > 0
    ? process.env.CODEX_HOME
    : path.join(os.homedir(), ".codex");
}

function generatedImagesDir(): string {
  return path.join(codexHome(), "generated_images");
}

/** Recursively list files under a dir with their mtime (ms). */
async function listFilesWithMtime(dir: string): Promise<{ file: string; mtimeMs: number }[]> {
  const out: { file: string; mtimeMs: number }[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFilesWithMtime(full)));
    } else if (e.isFile()) {
      try {
        const st = await fs.stat(full);
        out.push({ file: full, mtimeMs: st.mtimeMs });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

/** The newest image file created at/after `sinceMs`, or null. */
async function newestImageSince(sinceMs: number): Promise<string | null> {
  const files = await listFilesWithMtime(generatedImagesDir());
  const imgs = files
    .filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f.file) && f.mtimeMs >= sinceMs - 2000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return imgs[0]?.file ?? null;
}

function runCodex(prompt: string, refPaths: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // -C sets the working root OUTSIDE the app repo so Codex never loads the
    // project's AGENTS.md (which hijacks it into coding-agent mode).
    // --skip-git-repo-check lets it run in the (non-repo) temp dir.
    // Args are quoted because shell:true is required to resolve the global
    // `codex` shim on Windows, and the temp path can contain spaces.
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      `"${cwd}"`,
    ];
    for (const r of refPaths) args.push("-i", `"${r}"`);
    args.push("-"); // read the prompt from stdin (avoids shell-quoting issues)

    // shell:true so the global `codex` shim (codex.cmd on Windows) resolves.
    const child = spawn("codex", args, { cwd, shell: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {}); // drain
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exec exited ${code}: ${stderr.slice(0, 500)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export type CodexImageOptions = {
  /** Text prompt describing the poster. */
  prompt: string;
  /** Reference image buffers (logo/header/footer/photos) for edit mode. */
  references?: { name: string; buffer: Buffer }[];
  /** e.g. "1024x1536". Passed through in the prompt as guidance. */
  size?: string;
  timeoutMs?: number;
};

/**
 * Run Codex's built-in image tool and return the resulting PNG as base64.
 * If references are provided, instructs an edit/compose that copies them faithfully.
 */
export async function codexImage(opts: CodexImageOptions): Promise<string> {
  const refs = opts.references ?? [];
  const size = opts.size ?? "1024x1536";
  const timeoutMs = opts.timeoutMs ?? Number(process.env.CODEX_TIMEOUT_MS ?? 360_000);

  // Work dir OUTSIDE the app repo (system temp) so Codex doesn't pick up the
  // project's AGENTS.md. Passed to Codex via -C.
  const workDir = path.join(os.tmpdir(), "codex-poster", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const refPaths: string[] = [];
  try {
    for (let i = 0; i < refs.length; i++) {
      const p = path.join(workDir, `ref${i}_${refs[i].name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await fs.writeFile(p, refs[i].buffer);
      refPaths.push(p);
    }

    // Build a detailed manifest so Codex knows what each reference image is
    let refManifest = "";
    if (refs.length > 0) {
      const lines = refs.map((r, idx) => {
        const role = (r as { role?: string }).role ?? r.name;
        const filename = refPaths[idx]?.split("/").pop() ?? `ref${idx}.png`;
        return `- ${filename}: ${role}`;
      });
      refManifest = `\n\nREFERENCE IMAGES — ${refs.length} image(s) are attached. Here is what each one is:
${lines.join("\n")}

RULES FOR REFERENCE IMAGES:
- LOGO images: reproduce the logo accurately in the poster — same shape, colors, and text.
- BRANDING SOURCE: extract school name and affiliation text from it.
- CONTACT SOURCE: extract phone, website, address from it.
- UPLOADED PHOTO images: include these photos AS-IS in the poster. Do NOT redraw, replace, or modify them.
- SAMPLE POSTER images: match this design quality and style.
- Use ONLY the uploaded photos provided. Do NOT generate additional AI photos that weren't provided.`;
    }

    const prompt = `Use your built-in image generation tool to create a single Instagram poster image.

CRITICAL SIZE REQUIREMENT: The image MUST be portrait orientation at exactly ${size} pixels (width x height). This is a 4:5 aspect ratio for Instagram. Do NOT generate landscape or square images.${refManifest}

Poster brief:
${opts.prompt}

Generate exactly one final poster image with the built-in image tool at ${size} portrait size. Do not write any code or scripts.`;

    console.log(`[codex-image] ${refPaths.length} reference images, prompt ${prompt.length} chars`);
    for (let ri = 0; ri < refs.length; ri++) {
      console.log(`[codex-image]   ref${ri}: ${refs[ri].name} (${(refs[ri].buffer.length / 1024).toFixed(0)} KB) — ${(refs[ri] as { role?: string }).role ?? "unknown role"}`);
    }

    // Retry once: Codex sessions can occasionally hang/time out transiently.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const start = Date.now();
        await runCodex(prompt, refPaths, workDir, timeoutMs);
        const newest = await newestImageSince(start);
        if (!newest) {
          throw new Error("Codex produced no image (none found in generated_images)");
        }
        const buf = await fs.readFile(newest);
        return buf.toString("base64");
      } catch (err) {
        lastErr = err;
        console.warn(`[codex-image] attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("codexImage failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
