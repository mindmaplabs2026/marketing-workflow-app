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
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text: `You are the CREATIVE DIRECTOR reviewing the rendered Instagram Reel for a school named "${input.schoolName}" against the art direction you specified.

Creative direction: "${input.reelDirection}"
${input.artDirection?.visualRegister ? `Intended visual register: ${input.artDirection.visualRegister}` : ""}
${input.artDirection?.colorPalette?.length ? `Intended COLOUR PALETTE (the reel should clearly use these): ${input.artDirection.colorPalette.join(", ")}` : ""}
${input.artDirection?.typography ? `Intended TYPOGRAPHY — heading: ${input.artDirection.typography.heading}, body: ${input.artDirection.typography.body}${input.artDirection.typography.accent ? `, accent: ${input.artDirection.typography.accent}` : ""}` : ""}

Below are ${keyframes.length} evenly-spaced keyframes from the rendered video. Evaluate the reel on:

1. VISUAL QUALITY (0-10): Is it visually polished? Good composition, no rendering artifacts?
2. TEXT READABILITY (0-10): Can text overlays be read clearly? Proper contrast? No text smaller than ~28px? Nothing flush to the frame edges?
3. BRAND PRESENCE (0-10): Is the school logo/name visible and a reasonable size (not tiny, not boxed in a big padded square)?
4. VISUAL COHERENCE (0-10): Do the keyframes look like they belong to the same video? Consistent style?
5. ENGAGEMENT (0-10): Would this stop a scroll on Instagram? Is it visually interesting?
6. DIRECTION ADHERENCE (0-10): Does the render MATCH the intended visual register, colour palette, and typography above? Score LOW if it ignored the palette/fonts, looks generic, or resembles a stock template instead of the specified register. Name the specific mismatch in weaknesses (e.g. "palette is blue/grey but spec was warm terracotta", "headings are a default sans, spec was Playfair Display").

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
          detail: "low",
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
