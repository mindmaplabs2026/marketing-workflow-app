/**
 * Codex chat-edit agent — vision + image generation in one session.
 *
 * Unlike OpenAI's images.edit (which does true inpainting), Codex's image tool
 * is a generation tool. To make edits work, we run a single Codex session that:
 *   1. Receives the CURRENT poster as a vision input (-i flag)
 *   2. Reads the user's edit instruction
 *   3. Uses its built-in image tool to generate the edited version
 *
 * This keeps the edit contextual — Codex sees the original poster, understands
 * what needs to change, and generates accordingly.
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
      } catch { /* ignore */ }
    }
  }
  return out;
}

async function newestImageSince(sinceMs: number): Promise<string | null> {
  const files = await listFilesWithMtime(generatedImagesDir());
  const imgs = files
    .filter((f) => /\.(png|webp|jpg|jpeg)$/i.test(f.file) && f.mtimeMs >= sinceMs - 2000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return imgs[0]?.file ?? null;
}

function runCodex(prompt: string, refPaths: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      `"${cwd}"`,
    ];
    for (const r of refPaths) args.push("-i", `"${r}"`);
    args.push("-");

    const child = spawn("codex", args, { cwd, shell: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex chat-edit timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex chat-edit exited ${code}: ${stderr.slice(0, 500)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export type CodexChatEditInput = {
  /** The current poster image as a buffer. */
  currentPoster: Buffer;
  /** The user's edit instruction (e.g., "Remove the logo in the middle"). */
  editMessage: string;
  /** Image size (e.g., "1024x1536"). */
  size?: string;
  timeoutMs?: number;
};

/**
 * Run a Codex session that sees the current poster and generates an edited version.
 * Returns the edited image as base64 PNG.
 */
export async function codexChatEdit(input: CodexChatEditInput): Promise<string> {
  const size = input.size ?? "1024x1536";
  const timeoutMs = input.timeoutMs ?? Number(process.env.CODEX_TIMEOUT_MS ?? 360_000);

  const workDir = path.join(os.tmpdir(), "codex-chat-edit", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Write the current poster to disk so Codex can see it via -i
    const posterPath = path.join(workDir, "current-poster.png");
    await fs.writeFile(posterPath, input.currentPoster);

    const prompt = `I am attaching the CURRENT version of an Instagram poster image (current-poster.png).

LOOK at this poster carefully. Study every element: the layout, colors, text, images, header, footer, logo placement, and overall composition.

The user wants this SPECIFIC change made:
"${input.editMessage}"

Now use your built-in image generation tool to create an EDITED version of this poster at ${size} (portrait).

CRITICAL RULES:
- Make ONLY the requested change. Everything else must stay EXACTLY the same.
- Same layout, same background, same colors, same branding, same header, same footer.
- Same photos in the same positions (unless the edit specifically asks to change them).
- Same text styling and positioning (unless the edit specifically asks to change it).
- The result should look like the same poster with just the one requested modification.

Generate exactly one edited poster image with the built-in image tool.`;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const start = Date.now();
        await runCodex(prompt, [posterPath], workDir, timeoutMs);
        const newest = await newestImageSince(start);
        if (!newest) {
          throw new Error("Codex chat-edit produced no image");
        }
        const buf = await fs.readFile(newest);
        console.log(`[codex-chat-edit] Success on attempt ${attempt} — image ${buf.length} bytes`);
        return buf.toString("base64");
      } catch (err) {
        lastErr = err;
        console.warn(`[codex-chat-edit] attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("codexChatEdit failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
