/**
 * Codex Poster Bridge — Option B: drive Codex's TEXT/vision reasoning from Node.
 *
 * Runs `codex exec` (ChatGPT subscription, no OpenAI key) and captures the
 * model's FINAL message via --output-last-message (clean — no stdout noise).
 * Optional images are attached with -i for the vision agents (Agent 1 curation,
 * Agent 2 creative, Agent 4 evaluate). Verified by spike: text and vision both
 * return clean JSON.
 *
 * Runs in a temp dir OUTSIDE the repo (-C + --skip-git-repo-check) so the
 * project's AGENTS.md can't hijack Codex into coding-agent mode.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexTextImage = { dataUrl?: string; buffer?: Buffer };

export type CodexTextInput = {
  /** Full combined prompt (system + user text). */
  prompt: string;
  /** Images for vision (data URLs or buffers). */
  images?: CodexTextImage[];
  timeoutMs?: number;
};

function runCodexCapture(
  prompt: string,
  refPaths: string[],
  outFile: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      `"${cwd}"`,
      "-o",
      `"${outFile}"`,
    ];
    for (const r of refPaths) args.push("-i", `"${r}"`);
    args.push("-"); // prompt on stdin

    const child = spawn("codex", args, { cwd, shell: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {}); // drain
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec (text) timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exec (text) exited ${code}: ${stderr.slice(0, 400)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** If the model wrapped its answer in a ```json fence, unwrap it. */
export function stripJsonFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/** Run Codex for a text/vision reasoning step and return its final message. */
export async function codexText(input: CodexTextInput): Promise<string> {
  const timeoutMs = input.timeoutMs ?? Number(process.env.CODEX_TEXT_TIMEOUT_MS ?? 300_000);
  const workDir = path.join(os.tmpdir(), "codex-text", `${process.pid}-${Date.now()}-${Math.round(performance.now())}`);
  await fs.mkdir(workDir, { recursive: true });
  const outFile = path.join(workDir, "out.txt");

  try {
    const refPaths: string[] = [];
    const imgs = input.images ?? [];
    for (let i = 0; i < imgs.length; i++) {
      let buf: Buffer | null = null;
      if (imgs[i].buffer && imgs[i].buffer!.length > 0) {
        buf = imgs[i].buffer!;
      } else if (imgs[i].dataUrl) {
        const u = imgs[i].dataUrl!;
        if (u.startsWith("data:")) {
          // data:image/...;base64,XXXX  (e.g. Agent 4 evaluator)
          const b64 = u.split(",")[1] ?? "";
          if (b64) buf = Buffer.from(b64, "base64");
        } else if (u.startsWith("http")) {
          // signed Supabase URL (e.g. Agent 1 / Agent 2) — fetch the bytes
          try {
            const res = await fetch(u);
            if (res.ok) buf = Buffer.from(await res.arrayBuffer());
          } catch {
            /* skip unreachable image */
          }
        }
      }
      if (buf && buf.length > 0) {
        const p = path.join(workDir, `img${i}.png`);
        await fs.writeFile(p, buf);
        refPaths.push(p);
      }
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await runCodexCapture(input.prompt, refPaths, outFile, workDir, timeoutMs);
        const out = (await fs.readFile(outFile, "utf8")).trim();
        if (!out) throw new Error("Codex returned an empty message");
        return out;
      } catch (err) {
        lastErr = err;
        console.warn(`[codex-text] attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("codexText failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
