import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReelScript } from "./agent-creative-reel";

const REMOTION_RENDERER_DIR =
  process.env.REMOTION_RENDERER_DIR ??
  path.resolve(__dirname, "../../../../remotion-renderer");

export type CompositionCode = {
  /** The full Reel.tsx source code. */
  reelTsx: string;
  /** Optional data.ts source code (may be inlined in Reel.tsx). */
  dataTsx?: string;
};

/**
 * Use Codex to write a Remotion composition (Reel.tsx) based on the reel script.
 *
 * Reads example compositions from remotion-renderer/examples/ as few-shot context,
 * then asks Codex to write a complete, compilable React component.
 *
 * Returns the raw source code — the caller writes it to the temp dir for rendering.
 */
export async function generateComposition(input: {
  script: ReelScript;
  /** Map of local media filenames (key) to description (value). */
  mediaManifest: Map<string, { type: "image" | "video"; description: string }>;
  /** Whether a logo file is available in media/. */
  hasLogo: boolean;
  /** Whether a music file is available in music/. */
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? 300_000; // 5 minutes
  const workDir = path.join(os.tmpdir(), "codex-composition", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    // Load example compositions + API reference
    const examplesDir = path.join(REMOTION_RENDERER_DIR, "examples");
    const readme = await fs.readFile(path.join(examplesDir, "README.md"), "utf8").catch(() => "");

    // Pick 2 examples that best match the visual register
    const exampleFiles = await pickRelevantExamples(input.script.visualRegister, examplesDir);
    const exampleContents: string[] = [];
    for (const file of exampleFiles) {
      const content = await fs.readFile(path.join(examplesDir, file), "utf8").catch(() => "");
      if (content) exampleContents.push(`--- EXAMPLE: ${file} ---\n${content}`);
    }

    // Build media manifest text
    const mediaLines: string[] = [];
    for (const [filename, info] of input.mediaManifest) {
      mediaLines.push(`- media/${filename} (${info.type}) — ${info.description}`);
    }
    if (input.hasLogo) mediaLines.push(`- media/logo.png (image) — school logo`);
    if (input.hasMusic) mediaLines.push(`- music/track.mp3 (audio) — background music`);

    // Load helpers.ts so Codex knows what's available
    const helpers = await fs.readFile(
      path.join(REMOTION_RENDERER_DIR, "scaffold", "helpers.ts"),
      "utf8",
    ).catch(() => "");

    const prompt = buildPrompt(input.script, mediaLines, readme, exampleContents, helpers);

    // Run Codex
    const outFile = path.join(workDir, "out.txt");
    console.log(`[Composition] Asking Codex to write Reel.tsx — ${prompt.length} chars prompt`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await runCodexCapture(prompt, outFile, workDir, timeoutMs);
        const raw = (await fs.readFile(outFile, "utf8")).trim();
        if (!raw) throw new Error("Codex returned empty output");

        // Extract Reel.tsx code from the response
        const code = extractCode(raw);
        if (!code.reelTsx) throw new Error("Could not extract Reel.tsx from Codex output");

        console.log(`[Composition] Got ${code.reelTsx.length} chars Reel.tsx` +
          (code.dataTsx ? ` + ${code.dataTsx.length} chars data.ts` : ""));
        return code;
      } catch (err) {
        lastErr = err;
        console.warn(`[Composition] Attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
        if (attempt === 1) {
          // Simplify prompt for retry
          console.log("[Composition] Retrying with simplified prompt...");
        }
      }
    }

    // All Codex attempts failed — generate a safe fallback slideshow
    console.warn("[Composition] All Codex attempts failed — using fallback slideshow generator");
    return generateFallbackComposition(input.script, input.mediaManifest, input.hasMusic);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Generate a safe, simple slideshow composition that always compiles.
 * Used as a last resort when Codex fails to produce valid code.
 */
function generateFallbackComposition(
  script: ReelScript,
  mediaManifest: Map<string, { type: "image" | "video"; description: string }>,
  hasMusic: boolean,
): CompositionCode {
  const FPS = 30;
  const TITLE_FRAMES = 4 * FPS;
  const CLOSING_FRAMES = 4 * FPS;
  const SCENE_FRAMES = 5 * FPS;

  const mediaFiles = [...mediaManifest.keys()];
  const totalFrames = TITLE_FRAMES + mediaFiles.length * SCENE_FRAMES + CLOSING_FRAMES;

  const palette = script.colorPalette.length >= 2
    ? script.colorPalette
    : ["#1a1a2e", "#e94560", "#ffffff", "#0f3460"];

  const reelTsx = `import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
${hasMusic ? 'import { Audio } from "@remotion/media";' : ""}
${mediaManifest.size > 0 && [...mediaManifest.values()].some((m) => m.type === "video") ? 'import { Video } from "@remotion/media";' : ""}

const FPS = 30;
const TITLE_FRAMES = ${TITLE_FRAMES};
const SCENE_FRAMES = ${SCENE_FRAMES};
const CLOSING_FRAMES = ${CLOSING_FRAMES};

const MEDIA = ${JSON.stringify(mediaFiles.map((f) => ({
    src: `media/${f}`,
    type: mediaManifest.get(f)?.type ?? "image",
  })), null, 2)};

export const REEL_DURATION = ${totalFrames};

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "${palette[0]}", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity }}>
      <div style={{ fontSize: 80, fontWeight: 900, color: "${palette[2]}", textAlign: "center", padding: "0 60px", lineHeight: 1.1 }}>
        ${JSON.stringify(script.titleCard.headline)}
      </div>
      <div style={{ fontSize: 32, color: "${palette[2]}88", marginTop: 20, letterSpacing: 4 }}>
        ${JSON.stringify(script.titleCard.subtitle)}
      </div>
    </AbsoluteFill>
  );
};

const SceneCard: React.FC<{ src: string; mediaType: string }> = ({ src, mediaType }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.06], { extrapolateRight: "clamp" });
  const opacity = Math.min(fadeIn, fadeOut);
  return (
    <AbsoluteFill style={{ background: "${palette[0]}", opacity }}>
      {mediaType === "video" ? (
        <Video src={staticFile(src)} muted objectFit="cover" style={{ width: "100%", height: "100%" }} />
      ) : (
        <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: \`scale(\${scale})\` }} />
      )}
    </AbsoluteFill>
  );
};

const ClosingCard: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "${palette[0]}", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity }}>
      <div style={{ fontSize: 48, fontWeight: 700, color: "${palette[2]}", textAlign: "center", padding: "0 60px" }}>
        ${JSON.stringify(script.closingCard.text)}
      </div>
      <div style={{ fontSize: 24, color: "${palette[1]}", marginTop: 30, letterSpacing: 6 }}>
        ${JSON.stringify(script.closingCard.callToAction)}
      </div>
      <div style={{ fontSize: 20, color: "${palette[2]}88", marginTop: 40 }}>
        ${JSON.stringify(script.brandingConfig.schoolName)}
      </div>
    </AbsoluteFill>
  );
};

${hasMusic ? `const MusicBed: React.FC = () => {
  const volume = (f: number) => {
    const fadeIn = interpolate(f, [0, 30], [0, 0.7], { extrapolateRight: "clamp" });
    const fadeOut = interpolate(f, [REEL_DURATION - 60, REEL_DURATION], [0.7, 0], { extrapolateLeft: "clamp" });
    return Math.min(fadeIn, fadeOut);
  };
  return <Audio src={staticFile("music/track.mp3")} volume={volume} />;
};` : ""}

export const Reel: React.FC = () => {
  let cursor = 0;
  const titleStart = cursor; cursor += TITLE_FRAMES;
  const sceneStarts = MEDIA.map(() => { const s = cursor; cursor += SCENE_FRAMES; return s; });
  const closingStart = cursor;
  return (
    <AbsoluteFill style={{ background: "${palette[0]}" }}>
      ${hasMusic ? "<MusicBed />" : ""}
      <Sequence from={titleStart} durationInFrames={TITLE_FRAMES} layout="none"><TitleCard /></Sequence>
      {MEDIA.map((m, i) => (
        <Sequence key={i} from={sceneStarts[i]} durationInFrames={SCENE_FRAMES} layout="none">
          <SceneCard src={m.src} mediaType={m.type} />
        </Sequence>
      ))}
      <Sequence from={closingStart} durationInFrames={CLOSING_FRAMES} layout="none"><ClosingCard /></Sequence>
    </AbsoluteFill>
  );
};
`;

  console.log(`[Composition] Fallback generated: ${totalFrames} frames, ${mediaFiles.length} scenes`);
  return { reelTsx };
}

function buildPrompt(
  script: ReelScript,
  mediaLines: string[],
  apiRef: string,
  examples: string[],
  helpers: string,
): string {
  return `You are writing a Remotion composition (React/TypeScript component) for an Instagram Reel video.

## CREATIVE DIRECTION
- Direction: ${script.direction}
- Visual Register: ${script.visualRegister}
- Theme: ${script.theme}
- Animation Style: ${script.animationStyle}

## COLOR PALETTE
${script.colorPalette.map((c) => `  ${c}`).join("\n")}

## TYPOGRAPHY
- Heading: ${script.typography.heading}
- Body: ${script.typography.body}
${script.typography.accent ? `- Accent: ${script.typography.accent}` : ""}

## SCENES (${script.scenes.length} total, ${script.durationSec}s)
Title Card (${script.titleCard.durationSec}s):
  Headline: "${script.titleCard.headline}"
  Subtitle: "${script.titleCard.subtitle}"

${script.scenes.map((s) => {
  let line = `Scene ${s.index} (${s.durationSec}s, ${s.mediaType}): media/${path.basename(s.mediaPath)}`;
  if (s.trimStartSec != null) line += ` [trim ${s.trimStartSec}-${s.trimEndSec}s]`;
  line += ` — focus: ${s.focusX}%,${s.focusY}%`;
  if (s.kenBurns) line += ` — Ken Burns: ${s.kenBurns.direction} (${s.kenBurns.intensity})`;
  if (s.textOverlay) line += `\n  Text: "${s.textOverlay.text}" at ${s.textOverlay.position} (${s.textOverlay.style})`;
  line += `\n  Transition out: ${s.transition}`;
  return line;
}).join("\n\n")}

Closing Card (${script.closingCard.durationSec}s):
  Text: "${script.closingCard.text}"
  CTA: "${script.closingCard.callToAction}"

## BRANDING
- Logo: ${script.brandingConfig.logoPlacement}
- School: ${script.brandingConfig.schoolName}

## MEDIA FILES AVAILABLE
${mediaLines.join("\n")}

## REMOTION API REFERENCE
${apiRef}

## AVAILABLE HELPERS (import from "./helpers")
\`\`\`tsx
${helpers}
\`\`\`

## EXAMPLE COMPOSITIONS (study these for patterns, but create something ORIGINAL)
${examples.join("\n\n")}

## RULES
1. Export a React.FC named "Reel" and a number constant "REEL_DURATION" (total frames at 30fps)
2. Use only these packages: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions
3. Media files: use staticFile("media/filename.ext") — NEVER include "public/" in the path. staticFile() resolves relative to the public/ folder automatically. CORRECT: staticFile("media/photo.jpg"). WRONG: staticFile("public/media/photo.jpg")
4. Music: use staticFile("music/track.mp3")
5. Canvas: 1080×1920 pixels, 30fps — ALWAYS
6. Include school branding (logo, name) as described above
7. Write COMPLETE, COMPILABLE TypeScript — every import, every type, every component
8. Do NOT use external assets or URLs — only staticFile() references
9. CRITICAL — VIDEO FILES: Files listed as "(video)" in the media list MUST be rendered with the <Video> component from "@remotion/media", NOT <Img>. Example:
   import { Video } from "@remotion/media";
   <Video src={staticFile("media/clip.mp4")} muted objectFit="cover" style={{width:"100%",height:"100%"}} />
   Use trimBefore={Math.round(startSec * 30)} and trimAfter={Math.round(endSec * 30)} for trimming.
   Image files (.jpg, .png) use <Img> from "remotion". Video files (.mp4, .mov) use <Video> from "@remotion/media".
   NEVER use <Img> for a .mp4 file. NEVER use <Video> for a .jpg file.
9. Load Google Fonts via @remotion/google-fonts (e.g., import { loadFont } from "@remotion/google-fonts/Poppins")
10. Calculate REEL_DURATION precisely from your timing constants

OUTPUT FORMAT:
Write the COMPLETE Reel.tsx file inside a single \`\`\`tsx code fence.
If you also need a separate data.ts, write it in a second \`\`\`tsx fence labeled "data.ts".

BEGIN:`;
}

/**
 * Extract Reel.tsx (and optionally data.ts) code from Codex output.
 * Looks for ```tsx code fences.
 */
function extractCode(raw: string): CompositionCode {
  const fences = [...raw.matchAll(/```(?:tsx?)\s*\n([\s\S]*?)```/g)];

  if (fences.length === 0) {
    // Maybe the whole output IS the code (no fences)
    if (raw.includes("export") && raw.includes("Reel")) {
      return { reelTsx: raw };
    }
    return { reelTsx: "" };
  }

  // First fence = Reel.tsx, second (if present) = data.ts
  const reelTsx = fences[0][1].trim();
  const dataTsx = fences.length > 1 ? fences[1][1].trim() : undefined;

  return { reelTsx, dataTsx };
}

/**
 * Pick 2 example files most relevant to the visual register description.
 */
async function pickRelevantExamples(
  visualRegister: string,
  examplesDir: string,
): Promise<string[]> {
  const lower = visualRegister.toLowerCase();
  const scores: [string, number][] = [
    ["scrapbook.md", scoreMatch(lower, ["notebook", "scrapbook", "polaroid", "handwritten", "warm", "letter", "memory", "emotional", "tape"])],
    ["kinetic-type.md", scoreMatch(lower, ["kinetic", "typography", "stamp", "bold", "beat", "energy", "impact", "brutalist", "word"])],
    ["iphone-pov.md", scoreMatch(lower, ["iphone", "pov", "camera", "handheld", "notification", "phone", "hud", "walk", "tour"])],
    ["bulletin.md", scoreMatch(lower, ["bulletin", "event", "recap", "formal", "clean", "card", "institutional", "college", "navy"])],
    ["magazine-editorial.md", scoreMatch(lower, ["magazine", "editorial", "premium", "glossy", "serif", "yearbook", "profile", "elegant", "curated"])],
    ["film-strip.md", scoreMatch(lower, ["film", "cinema", "retro", "vintage", "darkroom", "noir", "strip", "nostalgi", "drama", "artistic"])],
    ["postcard-stack.md", scoreMatch(lower, ["postcard", "travel", "trip", "stamp", "mail", "diary", "wooden", "table", "memories", "farewell"])],
    ["split-screen.md", scoreMatch(lower, ["split", "grid", "geometric", "modern", "minimal", "comparison", "side", "triptych", "gallery"])],
    ["minimal-card.md", scoreMatch(lower, ["minimal", "floating", "card", "clean", "apple", "spotlight", "gallery", "showcase", "negative", "space"])],
  ];

  // Sort by score descending, pick top 2
  scores.sort((a, b) => b[1] - a[1]);

  // Verify files exist
  const picked: string[] = [];
  for (const [file] of scores) {
    const exists = await fs.stat(path.join(examplesDir, file)).then(() => true).catch(() => false);
    if (exists) picked.push(file);
    if (picked.length === 2) break;
  }

  // If fewer than 2 found, just return what we have
  return picked;
}

function scoreMatch(text: string, keywords: string[]): number {
  return keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
}

/**
 * Refine an existing composition based on evaluation feedback.
 * Gives Codex the original code + feedback, asks for targeted improvements.
 */
export async function refineReelComposition(input: {
  originalCode: string;
  feedback: string;
  weaknesses: string[];
  script: ReelScript;
  mediaManifest: Map<string, { type: "image" | "video"; description: string }>;
  hasLogo: boolean;
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? 300_000;
  const workDir = path.join(os.tmpdir(), "codex-refine", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    const prompt = `You are refining a Remotion composition (React/TypeScript) for an Instagram Reel.

The reel was rendered and evaluated. Here is the evaluation feedback:

SCORE: Below passing threshold
FEEDBACK: ${input.feedback}
WEAKNESSES:
${input.weaknesses.map((w) => `- ${w}`).join("\n")}

Here is the ORIGINAL Reel.tsx code that needs improvement:

\`\`\`tsx
${input.originalCode}
\`\`\`

CREATIVE DIRECTION (unchanged):
- Direction: ${input.script.direction}
- Visual Register: ${input.script.visualRegister}
- Theme: ${input.script.theme}

RULES:
1. Fix the specific weaknesses listed above
2. Keep the same overall structure and creative direction
3. Export "Reel" (React.FC) and "REEL_DURATION" (number in frames)
4. Canvas: 1080x1920, 30fps
5. Use only: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions
6. Media paths: use staticFile("media/filename.ext") and staticFile("music/track.mp3") — NEVER include "public/" in the path
7. Write COMPLETE, COMPILABLE TypeScript

OUTPUT: Write the COMPLETE improved Reel.tsx inside a single \`\`\`tsx code fence.

BEGIN:`;

    const outFile = path.join(workDir, "out.txt");
    console.log(`[Refine] Asking Codex to fix composition — ${prompt.length} chars`);

    await runCodexCapture(prompt, outFile, workDir, timeoutMs);
    const raw = (await fs.readFile(outFile, "utf8")).trim();
    if (!raw) throw new Error("Codex returned empty refinement output");

    const code = extractCode(raw);
    if (!code.reelTsx) throw new Error("Could not extract refined Reel.tsx");

    console.log(`[Refine] Got ${code.reelTsx.length} chars refined Reel.tsx`);
    return code;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Spawn codex exec, write prompt to stdin, capture output to file. */
function runCodexCapture(
  prompt: string,
  outFile: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C", `"${cwd}"`,
      "-o", `"${outFile}"`,
      "-",
    ];

    const child = spawn("codex", args, { cwd, shell: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.stdout.on("data", () => {});
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec (composition) timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`codex exec (composition) exited ${code}: ${stderr.slice(0, 400)}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
