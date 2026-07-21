/**
 * EDIT ANALYZER for reel chat-edits — currently running in SHADOW MODE.
 *
 * Reads everything the editor cannot see today (full chat history, frames of the
 * CURRENT rendered reel, user attachments, the composition source) and produces a
 * structured EditSpec: a self-contained instruction with precise targets, plus a
 * diagnosis of any previously failed rounds.
 *
 * SHADOW MODE means: runReelChatEdit calls this best-effort, LOGS the spec (worker
 * log + assistant message metadata) and then runs the edit exactly as before —
 * the spec does not drive anything yet. Every real chat-edit thereby becomes an
 * eval case; once the specs prove reliable, the editor switches to consuming
 * spec.instruction (and spec.userFacingSummary replaces the separate confirmation
 * call). Validated by a manual dry-run on variation d4dfd60d (2026-07-22):
 * byte-exact unique anchor, correct scene + cross-round attachment resolution, 23s.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { codexText, stripJsonFences, type CodexTextImage } from "./codex-text";

const EditSpecSchema = z.object({
  /** ONE self-contained instruction for the editor — all chat references resolved. */
  instruction: z.string(),
  /** 1-2 friendly sentences confirming what will change (future confirmation reply). */
  userFacingSummary: z.string(),
  targets: z.array(
    z.object({
      /** Which scene, with its visible text and approx time range in the video. */
      sceneHint: z.string(),
      /** Short VERBATIM snippet from the composition source locating the change. */
      codeAnchor: z.string(),
      /** The precise change at that anchor (exact old value -> exact new value). */
      change: z.string(),
    }),
  ),
  attachmentUse: z.enum(["annotation", "insert", "replace", "none"]).catch("none"),
  musicIntent: z.enum(["keep", "duck", "off", "change"]).catch("keep"),
  /** Files the request needs that are NOT available as render assets. */
  missingAssets: z.array(z.string()).catch([]),
  /** What went wrong in previous rounds, if the conversation shows failed attempts. */
  diagnosis: z.string().catch(""),
  confidence: z.enum(["high", "low"]).catch("low"),
});

export type ReelEditSpec = z.infer<typeof EditSpecSchema> & {
  /** Per-target: how many times its codeAnchor appears verbatim in the source (1 = gate-clean). */
  anchorMatches: number[];
  elapsedSec: number;
};

export type AnalyzeReelEditInput = {
  /** Full chat history, oldest first (the current message is usually the last user row). */
  history: Array<{ role: string; content: string; attachmentCount: number }>;
  /** The user message being processed. */
  message: string;
  /** Composition source: Reel.tsx for free-form reels, ReelDoc JSON for schema reels. */
  compositionSource: string;
  compositionKind: "tsx" | "reeldoc-json";
  /** Formatted lines of every render asset the editor may reference. */
  filesList: string;
  /** The current rendered reel. */
  mp4: Buffer;
  /** User-attached images (all rounds), in attachment-N order. */
  attachments: Buffer[];
  durationSec: number;
  timeoutMs?: number;
};

/**
 * Sample frames evenly across the reel (single ffmpeg pass, same approach as the
 * evaluator's keyframes). Returns each frame with its timestamp.
 */
async function sampleFrames(
  mp4: Buffer,
  workDir: string,
  maxFrames: number,
  durationSec: number,
): Promise<{ timestampSec: number; buffer: Buffer }[]> {
  const mp4Path = path.join(workDir, "current.mp4");
  await fs.writeFile(mp4Path, mp4);
  const interval = durationSec > 0 ? Math.max(2, Math.ceil(durationSec / maxFrames)) : 5;
  const count = durationSec > 0 ? Math.max(1, Math.min(maxFrames, Math.ceil(durationSec / interval))) : 8;
  const pattern = path.join(workDir, "frame_%02d.png");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-i", mp4Path, "-vf", `fps=1/${interval},scale=360:-1`, "-frames:v", String(count), "-y", pattern],
      { cwd: workDir, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    const timer = setTimeout(() => { child.kill(); reject(new Error("ffmpeg frame sampling timed out")); }, 30_000);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });

  const frames: { timestampSec: number; buffer: Buffer }[] = [];
  const files = (await fs.readdir(workDir)).filter((f) => f.startsWith("frame_")).sort();
  for (let i = 0; i < files.length; i++) {
    frames.push({ timestampSec: i * interval, buffer: await fs.readFile(path.join(workDir, files[i])) });
  }
  return frames;
}

/**
 * Run the analyzer once. Returns null on ANY failure (bad JSON, validation, ffmpeg,
 * timeout) — shadow mode must never affect the edit itself. The caller logs the spec.
 */
export async function analyzeReelEdit(input: AnalyzeReelEditInput): Promise<ReelEditSpec | null> {
  const startTime = Date.now();
  const workDir = path.join(os.tmpdir(), "edit-analyzer", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const frames = await sampleFrames(input.mp4, workDir, 12, input.durationSec);
    const frameTimes = frames.map((f) => `t${f.timestampSec}s`).join(", ");

    const transcript = input.history
      .map((m) => `${m.role.toUpperCase()}${m.attachmentCount > 0 && m.role === "user" ? ` [attached ${m.attachmentCount} image(s)]` : ""}: ${m.content}`)
      .join("\n\n");

    const attachmentNote = input.attachments.length
      ? `${frames.length + 1}-${frames.length + input.attachments.length}: the user's attached image(s), available to the render as media/attachment-1.png … media/attachment-${input.attachments.length}.png (in that order)`
      : "(no user attachments)";

    const sourceLabel = input.compositionKind === "tsx"
      ? "CURRENT Reel.tsx (the composition that produced the current video)"
      : "CURRENT ReelDoc JSON (the structured document that produced the current video)";

    const prompt = `You are the EDIT ANALYZER for an Instagram Reel editing pipeline. Your job is to READ everything (conversation, video frames, attached images, composition source) and produce a precise, structured edit specification. You do NOT edit anything yourself — a separate editor agent will apply your spec. Be exact; the editor sees only your spec, not the conversation. If the request cannot be satisfied with the available files, say so via missingAssets instead of inventing a substitute.

CONVERSATION SO FAR (oldest first; the LAST user message is the edit request to analyze):
${transcript}

EDIT REQUEST BEING ANALYZED:
"${input.message}"

IMAGES PROVIDED TO YOU (in order):
1-${frames.length}: frames sampled from the CURRENT rendered reel at ${frameTimes} (video is ${Math.round(input.durationSec)}s total)
${attachmentNote}

FILES THAT EXIST AS RENDER ASSETS (the editor may ONLY reference these):
${input.filesList}

${sourceLabel}:
\`\`\`
${input.compositionSource}
\`\`\`

Produce ONLY a JSON object (no prose, no fences) with this exact shape:
{
  "instruction": string,        // ONE self-contained instruction for the editor. Resolve ALL references from the conversation (which frame, which photo, which file). Name exact files and exact code targets.
  "userFacingSummary": string,  // 1-2 friendly sentences confirming what will change
  "targets": [{
    "sceneHint": string,        // which scene, with its visible text and approx time range in the video
    "codeAnchor": string,       // a SHORT snippet copied VERBATIM from the composition source above that uniquely locates the code to change
    "change": string            // the precise change at that anchor (exact old value -> exact new value)
  }],
  "attachmentUse": "annotation" | "insert" | "replace" | "none",  // how the user-attached image(s) should be used
  "musicIntent": "keep" | "duck" | "off" | "change",
  "missingAssets": string[],    // any file the request needs that is NOT in the FILES list (empty if none)
  "diagnosis": string,          // what went wrong in previous rounds, if the conversation shows failed attempts
  "confidence": "high" | "low"
}`;

    const images: CodexTextImage[] = [
      ...frames.map((f) => ({ buffer: f.buffer, detail: "low" as const })),
      ...input.attachments.map((buffer) => ({ buffer, detail: "high" as const })),
    ];

    const raw = await codexText({ prompt, images, timeoutMs: input.timeoutMs ?? 240_000 });
    const parsed = EditSpecSchema.safeParse(JSON.parse(stripJsonFences(raw)));
    if (!parsed.success) {
      console.warn(`[edit-analyzer] spec failed validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return null;
    }
    // Anchor verification — the shadow-mode quality signal: 1 = the future gate
    // would accept this target as-is; 0 or >1 = it would need a retry.
    const anchorMatches = parsed.data.targets.map((t) => countOccurrences(input.compositionSource, t.codeAnchor));
    return { ...parsed.data, anchorMatches, elapsedSec: (Date.now() - startTime) / 1000 };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) { count++; idx = haystack.indexOf(needle, idx + needle.length); }
  return count;
}
