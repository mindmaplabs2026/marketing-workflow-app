/**
 * Codex carousel page generation — vision-based style matching.
 *
 * For carousel pages 2+, we send page 1's output as a VISION input
 * so Codex can SEE and understand the exact visual style, then generate
 * a new page that matches it while using different photos and text.
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
      reject(new Error(`codex carousel-page timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex carousel-page exited ${code}: ${stderr.slice(0, 500)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export type CarouselPageInput = {
  page1Image: Buffer;
  pagePhotos: { name: string; buffer: Buffer }[];
  brandAssets: { name: string; buffer: Buffer; role: string }[];
  prompt: string;
  pageNumber: number;
  totalPages: number;
  size?: string;
  timeoutMs?: number;
};

export async function codexCarouselPage(input: CarouselPageInput): Promise<string> {
  const size = input.size ?? "1024x1536";
  const timeoutMs = input.timeoutMs ?? Number(process.env.CODEX_TIMEOUT_MS ?? 360_000);

  const workDir = path.join(os.tmpdir(), "codex-carousel", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const allRefPaths: string[] = [];

    const page1Path = path.join(workDir, "PAGE_1_STYLE_REFERENCE.png");
    await fs.writeFile(page1Path, input.page1Image);
    allRefPaths.push(page1Path);

    for (let i = 0; i < input.brandAssets.length; i++) {
      const a = input.brandAssets[i];
      const p = path.join(workDir, `brand_${i}_${a.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await fs.writeFile(p, a.buffer);
      allRefPaths.push(p);
    }

    for (let i = 0; i < input.pagePhotos.length; i++) {
      const ph = input.pagePhotos[i];
      const p = path.join(workDir, `photo_${i}_${ph.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await fs.writeFile(p, ph.buffer);
      allRefPaths.push(p);
    }

    const manifestLines: string[] = [
      `- PAGE_1_STYLE_REFERENCE.png: THIS IS PAGE 1 OF THE CAROUSEL. STUDY THIS IMAGE CAREFULLY. Your output must visually match its EXACT style.`,
    ];
    for (let i = 0; i < input.brandAssets.length; i++) {
      manifestLines.push(`- brand_${i}_...: ${input.brandAssets[i].role}`);
    }
    for (let i = 0; i < input.pagePhotos.length; i++) {
      manifestLines.push(`- photo_${i}_...: UPLOADED PHOTO — include this photo AS-IS in the poster. Do NOT redraw or replace it.`);
    }

    const prompt = `You are generating PAGE ${input.pageNumber} of a ${input.totalPages}-page Instagram carousel.

FIRST AND MOST IMPORTANT: Look at the attached image "PAGE_1_STYLE_REFERENCE.png". This is page 1 of the carousel. STUDY IT CAREFULLY:
- Note the exact position and size of the school logo
- Note the exact position and style of the school name and branding text
- Note the exact background color, gradient, and texture
- Note the typography: font style, size, color, and positioning
- Note the border/frame treatment
- Note the footer/contact area: position, colors, content
- Note any decorative elements: leaves, patterns, icons

YOUR PAGE ${input.pageNumber} MUST MATCH ALL OF THESE ELEMENTS EXACTLY. The ONLY things that change are:
- The headline text (specified below)
- The hero photos (different photos for this page)
- Minor subtitle text

ATTACHED IMAGES:
${manifestLines.join("\n")}

This page has ${input.pagePhotos.length} uploaded photo(s). Include ALL of them. Do NOT add AI-generated photos.

Now use your built-in image generation tool to create page ${input.pageNumber}.

CRITICAL SIZE: Portrait ${size} pixels (4:5 ratio).

PAGE ${input.pageNumber} BRIEF:
${input.prompt}

Generate exactly one poster image matching page 1's visual style. Do not write code.`;

    console.log(`[codex-carousel] Page ${input.pageNumber}: ${allRefPaths.length} refs (1 style + ${input.brandAssets.length} brand + ${input.pagePhotos.length} photos), prompt ${prompt.length} chars`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const start = Date.now();
        await runCodex(prompt, allRefPaths, workDir, timeoutMs);
        const newest = await newestImageSince(start);
        if (!newest) {
          throw new Error("Codex carousel-page produced no image");
        }
        const buf = await fs.readFile(newest);
        console.log(`[codex-carousel] Page ${input.pageNumber}: Success on attempt ${attempt} — ${(buf.length / 1024).toFixed(0)} KB`);
        return buf.toString("base64");
      } catch (err) {
        lastErr = err;
        console.warn(`[codex-carousel] Page ${input.pageNumber} attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("codexCarouselPage failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
