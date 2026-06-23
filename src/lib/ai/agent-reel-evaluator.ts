import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import type { CostTracker } from "./cost-tracker";

/** A precise, LOCATED defect the refiner should fix. */
export type ReelFinding = {
  /** Seconds into the reel where it's visible (from the nearest labelled keyframe). */
  timestamp: number;
  /** Where on the frame / which element: e.g. "bottom caption", "logo top-right", "title". */
  area: string;
  /** What is wrong: overlap / low contrast / misalignment / muted colour / flat / clipped, etc. */
  issue: string;
  /** A concrete suggested correction the code-writer can act on. */
  fix: string;
  severity: "high" | "medium" | "low";
};

export type ReelEvaluation = {
  score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
  /** Per-dimension scores (0-10), so you can see WHICH axis drove the overall score. */
  dimensions: Record<string, number>;
  /** Precise, located, actionable defects — the real instructions for the refiner. */
  findings: ReelFinding[];
  /** The evaluated keyframes (base64 data URLs + timestamp) so the refiner can SEE the render. */
  keyframes: { timestamp: number; dataUrl: string }[];
};

/**
 * Evaluate a rendered reel by extracting keyframes and scoring them with
 * GPT-4o-mini vision. Returns a score (0-10) and feedback.
 */
export async function evaluateReel(input: {
  mp4Path: string;
  schoolName: string;
  reelDirection: string;
  /** The art direction the reel was SUPPOSED to deliver — judged for adherence. */
  artDirection?: {
    visualRegister?: string;
    colorPalette?: string[];
    typography?: { heading: string; body: string; accent?: string };
  };
  costTracker?: CostTracker;
}): Promise<ReelEvaluation> {
  const workDir = path.join(os.tmpdir(), "reel-eval", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Extract keyframes — one every 5 seconds, max 8
    const keyframes = await extractKeyframes(input.mp4Path, workDir);
    console.log(`[ReelEval] Extracted ${keyframes.length} keyframes from ${input.mp4Path}`);

    if (keyframes.length === 0) {
      return {
        score: 3,
        feedback: "Could not extract keyframes — video may be corrupted or too short.",
        strengths: [],
        weaknesses: ["No keyframes extractable"],
        dimensions: {},
        findings: [],
        keyframes: [],
      };
    }

    // Build vision messages with keyframe images
    const openai = await getModelClient();

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "high" } }
    > = [
      {
        type: "text",
        text: `You are a DEMANDING, INDEPENDENT social-media art director. You did NOT make this reel — you are seeing it cold, for the first time, for a school named "${input.schoolName}". Your job is to judge it HARSHLY against the best school/brand Reels on Instagram, NOT to be kind to it. Assume it is mediocre until the frames prove otherwise. Most first drafts are flat and templatey; if this one is, say so and score it low — a generous score that lets weak work ship is a failure on YOUR part.

Do NOT grade it merely on whether it "follows the brief". A reel can follow a brief perfectly and still be lifeless. Judge whether it is genuinely VIBRANT, polished, and scroll-stopping in its own right. The brief below is context for what was INTENDED — use it only for the adherence axis, never as the bar for quality.

Intended creative direction (context only): "${input.reelDirection}"
${input.artDirection?.visualRegister ? `Intended visual register: ${input.artDirection.visualRegister}` : ""}
${input.artDirection?.colorPalette?.length ? `Intended COLOUR PALETTE (the reel should clearly use these): ${input.artDirection.colorPalette.join(", ")}` : ""}
${input.artDirection?.typography ? `Intended TYPOGRAPHY — heading: ${input.artDirection.typography.heading}, body: ${input.artDirection.typography.body}${input.artDirection.typography.accent ? `, accent: ${input.artDirection.typography.accent}` : ""}` : ""}

Below are ${keyframes.length} keyframes sampled across the WHOLE reel; each is labelled with its TIMESTAMP (seconds). When you spot a defect, note the timestamp of the frame it appears in so it can be located and fixed. Evaluate the reel on:

1. VISUAL QUALITY (0-10): Is it visually polished? Good composition, no rendering artifacts? Look HARD for OVERLAPPING or COLLIDING elements — e.g. a bottom ticker/marquee running into a notification/"now playing" card, two text boxes on top of each other, chrome clipped by the frame edge. Any visible overlap/collision is a serious defect — score LOW and name exactly which elements overlap in weaknesses.
2. TEXT READABILITY (0-10): Can text overlays be read clearly? Proper contrast? No text smaller than ~28px? Nothing flush to the frame edges? No text colliding with other text/elements?
3. BRAND PRESENCE (0-10): Is the school logo visible and a reasonable size (NOT tiny, not boxed in a big padded square)? CHECK FOR DUPLICATION: if the logo image already contains the school name as text, the composition must NOT also print the school name beside/under it — a doubled school name is a defect; flag it and score low. A logo shrunk into a small notification card is "too tiny" — flag it.
4. VISUAL COHERENCE (0-10): Do the keyframes look like they belong to the same video? Consistent style?
5. VISUAL ENERGY & RICHNESS (0-10): Would this stop a scroll? Does it look DESIGNED and vibrant, or flat and templatey? Score LOW if frames look static and bare — plain backgrounds, centered text with no treatment, no decorative layer (gradient scrims, accent shapes, chips, depth), washed-out/muted colour, or a generic slideshow feel. Score HIGH for bold saturated colour, layered composition, designed type treatment, and frames that imply motion/dynamism. In weaknesses, say specifically what would make it more vibrant (e.g. "backgrounds are flat grey — add gradient + accent bars", "title is plain centered text — needs animated, designed treatment").
6. DIRECTION ADHERENCE (0-10): Does the render honour the intended palette, typography, and register as a STARTING POINT? Score LOW only when it ignored the brand/palette/fonts or looks like a generic stock template. Do NOT penalise a render for being bolder, more animated, or more polished than the brief implied — exceeding the brief is GOOD. Penalise drift that hurts the result or goes off-brand (e.g. "palette is blue/grey but brand + spec were warm terracotta", "headings are a default sans, spec was Playfair Display"), not improvement.

Then list FINDINGS: precise, LOCATED, actionable defects — these are the literal instructions a code-writer will use to fix the reel, so be specific. For EACH real defect, give: the timestamp of the frame it's in, WHERE it is (which element/area), WHAT is wrong, and a CONCRETE fix. Examples of good findings:
- { "timestamp": 42, "area": "bottom caption", "issue": "caption overlaps the running ticker bar", "fix": "move the caption block above the ticker, leaving a 24px gap, or remove the ticker", "severity": "high" }
- { "timestamp": 8, "area": "title text", "issue": "white title on a light-blue background — too little contrast to read", "fix": "add a dark gradient scrim behind the title or switch the title to the dark navy palette colour", "severity": "high" }
- { "timestamp": 60, "area": "logo top-right", "issue": "logo is tiny inside a padded card AND the school name is printed next to a logo that already contains it", "fix": "enlarge the logo to ~220px longest edge and remove the duplicate school-name text", "severity": "medium" }
Only report REAL, visible defects (don't invent). If the reel is clean, return an empty findings array.

Return JSON:
{
  "visual_quality": number,
  "text_readability": number,
  "brand_presence": number,
  "visual_coherence": number,
  "engagement": number,
  "direction_adherence": number,
  "overall_score": number (average of all 6),
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "findings": [{ "timestamp": number, "area": "string", "issue": "string", "fix": "string", "severity": "high|medium|low" }],
  "feedback": "one paragraph summary with specific, actionable fixes — call out any palette/font/register drift first"
}`,
      },
    ];

    // Read each keyframe ONCE into a base64 data URL — used both for the vision call
    // and returned to the caller so the refiner can SEE the render (workDir is deleted
    // in finally). Each image is preceded by a timestamp label so findings can cite it.
    const frames: { timestamp: number; dataUrl: string }[] = [];
    for (const kf of keyframes) {
      const buf = await fs.readFile(kf.path);
      const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;
      frames.push({ timestamp: kf.timestamp, dataUrl });
      userContent.push({ type: "text", text: `[keyframe @ ${kf.timestamp}s]` });
      userContent.push({
        type: "image_url",
        image_url: { url: dataUrl, detail: "high" },
      });
    }

    const response = await withRateLimitRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 3000,
        messages: [
          {
            role: "system",
            content: "You are a video quality evaluator for Instagram Reels. Return only valid JSON.",
          },
          { role: "user", content: userContent },
        ],
      }),
    );

    const content = response.choices[0]?.message?.content ?? "{}";
    input.costTracker?.addLLMCall(
      "reel-evaluator",
      "gpt-4o-mini",
      response.usage as Record<string, number> | undefined,
    );

    const parsed = JSON.parse(content) as {
      overall_score?: number;
      feedback?: string;
      strengths?: string[];
      weaknesses?: string[];
      findings?: ReelFinding[];
      visual_quality?: number;
      text_readability?: number;
      brand_presence?: number;
      visual_coherence?: number;
      engagement?: number;
      direction_adherence?: number;
    };

    const score = parsed.overall_score ?? 5;
    // Keep the per-dimension scores (previously discarded) so the low axis is visible.
    const dimensions: Record<string, number> = {};
    for (const k of ["visual_quality", "text_readability", "brand_presence", "visual_coherence", "engagement", "direction_adherence"] as const) {
      if (typeof parsed[k] === "number") dimensions[k] = parsed[k] as number;
    }
    const weaknesses = parsed.weaknesses ?? [];
    const feedback = parsed.feedback ?? "No feedback provided.";
    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    // Log the FULL breakdown (not a truncated snippet) so it's auditable in the worker log.
    const dimStr = Object.entries(dimensions).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`[ReelEval] Score: ${score}/10  [${dimStr}]`);
    console.log(`[ReelEval] Feedback: ${feedback}`);
    for (const f of findings) {
      console.log(`[ReelEval] Finding @${f.timestamp}s (${f.severity}) ${f.area}: ${f.issue} → ${f.fix}`);
    }

    return {
      score,
      feedback,
      strengths: parsed.strengths ?? [],
      weaknesses,
      dimensions,
      findings,
      keyframes: frames,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Probe an mp4's duration (seconds) with ffprobe. Returns 0 on failure. */
async function probeDurationSec(mp4Path: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", mp4Path,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("close", () => resolve(parseFloat(out.trim()) || 0));
    child.on("error", () => resolve(0));
    setTimeout(() => { child.kill(); resolve(0); }, 10_000);
  });
}

/**
 * Extract keyframes EVENLY ACROSS THE WHOLE reel (not just the first ~40s) and return
 * each with its timestamp, so findings can be located in time. The interval stretches
 * with duration to stay within a bounded frame budget (REEL_EVAL_MAX_FRAMES, default 12).
 */
async function extractKeyframes(mp4Path: string, workDir: string): Promise<{ path: string; timestamp: number }[]> {
  const durationSec = await probeDurationSec(mp4Path);
  const MAX_FRAMES = Number(process.env.REEL_EVAL_MAX_FRAMES ?? 12);
  const interval = durationSec > 0 ? Math.max(2, Math.ceil(durationSec / MAX_FRAMES)) : 5;
  const count = durationSec > 0 ? Math.max(1, Math.min(MAX_FRAMES, Math.ceil(durationSec / interval))) : 8;
  const pattern = path.join(workDir, "keyframe_%02d.png");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", mp4Path,
      "-vf", `fps=1/${interval}`,
      "-frames:v", String(count),
      "-y",
      pattern,
    ], {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ffmpeg keyframe extraction timed out"));
    }, 30_000);

    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
    });
  });

  // Collect generated keyframe files; frame index i was sampled at i*interval seconds.
  const files = await fs.readdir(workDir);
  return files
    .filter((f) => f.startsWith("keyframe_") && f.endsWith(".png"))
    .sort()
    .map((f, i) => ({ path: path.join(workDir, f), timestamp: i * interval }));
}
