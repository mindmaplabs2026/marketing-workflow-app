import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import type { CostTracker } from "./cost-tracker";

export type ReelEvaluation = {
  score: number;
  feedback: string;
  strengths: string[];
  weaknesses: string[];
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

Below are ${keyframes.length} evenly-spaced keyframes from the rendered video. Evaluate the reel on:

1. VISUAL QUALITY (0-10): Is it visually polished? Good composition, no rendering artifacts? Look HARD for OVERLAPPING or COLLIDING elements — e.g. a bottom ticker/marquee running into a notification/"now playing" card, two text boxes on top of each other, chrome clipped by the frame edge. Any visible overlap/collision is a serious defect — score LOW and name exactly which elements overlap in weaknesses.
2. TEXT READABILITY (0-10): Can text overlays be read clearly? Proper contrast? No text smaller than ~28px? Nothing flush to the frame edges? No text colliding with other text/elements?
3. BRAND PRESENCE (0-10): Is the school logo visible and a reasonable size (NOT tiny, not boxed in a big padded square)? CHECK FOR DUPLICATION: if the logo image already contains the school name as text, the composition must NOT also print the school name beside/under it — a doubled school name is a defect; flag it and score low. A logo shrunk into a small notification card is "too tiny" — flag it.
4. VISUAL COHERENCE (0-10): Do the keyframes look like they belong to the same video? Consistent style?
5. VISUAL ENERGY & RICHNESS (0-10): Would this stop a scroll? Does it look DESIGNED and vibrant, or flat and templatey? Score LOW if frames look static and bare — plain backgrounds, centered text with no treatment, no decorative layer (gradient scrims, accent shapes, chips, depth), washed-out/muted colour, or a generic slideshow feel. Score HIGH for bold saturated colour, layered composition, designed type treatment, and frames that imply motion/dynamism. In weaknesses, say specifically what would make it more vibrant (e.g. "backgrounds are flat grey — add gradient + accent bars", "title is plain centered text — needs animated, designed treatment").
6. DIRECTION ADHERENCE (0-10): Does the render honour the intended palette, typography, and register as a STARTING POINT? Score LOW only when it ignored the brand/palette/fonts or looks like a generic stock template. Do NOT penalise a render for being bolder, more animated, or more polished than the brief implied — exceeding the brief is GOOD. Penalise drift that hurts the result or goes off-brand (e.g. "palette is blue/grey but brand + spec were warm terracotta", "headings are a default sans, spec was Playfair Display"), not improvement.

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
  "feedback": "one paragraph summary with specific, actionable fixes — call out any palette/font/register drift first"
}`,
      },
    ];

    // Attach keyframes as base64 images
    for (const kf of keyframes) {
      const buf = await fs.readFile(kf);
      const b64 = buf.toString("base64");
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${b64}`,
          detail: "high",
        },
      });
    }

    const response = await withRateLimitRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 2000,
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
    };

    const score = parsed.overall_score ?? 5;
    console.log(`[ReelEval] Score: ${score}/10 — ${parsed.feedback?.slice(0, 100)}...`);

    return {
      score,
      feedback: parsed.feedback ?? "No feedback provided.",
      strengths: parsed.strengths ?? [],
      weaknesses: parsed.weaknesses ?? [],
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract keyframes from an MP4 using ffmpeg.
 * Takes one frame every 5 seconds, up to 8 frames.
 */
async function extractKeyframes(mp4Path: string, workDir: string): Promise<string[]> {
  const pattern = path.join(workDir, "keyframe_%02d.png");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-i", mp4Path,
      "-vf", "fps=1/5",
      "-frames:v", "8",
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

  // Collect generated keyframe files
  const files = await fs.readdir(workDir);
  return files
    .filter((f) => f.startsWith("keyframe_") && f.endsWith(".png"))
    .sort()
    .map((f) => path.join(workDir, f));
}
