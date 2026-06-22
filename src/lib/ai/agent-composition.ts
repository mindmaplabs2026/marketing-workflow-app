import "server-only";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ReelScript } from "./agent-creative-reel";
import { CodexUsageLimitError, extractCodexError } from "./codex-text";
import type { LogoProfile } from "./logo-analysis";
import type { RenderResult } from "@/lib/remotion/render";

/** Assets needed to render a composition (shared by generation + chat-edit). */
export type RenderAssets = {
  mediaFiles: Map<string, Buffer>;
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  musicFile?: { name: string; buffer: Buffer };
  hasLogo: boolean;
  logoProfile?: LogoProfile;
  hasFooter?: boolean;
  hasMusic: boolean;
};

const REMOTION_RENDERER_DIR =
  process.env.REMOTION_RENDERER_DIR ??
  path.resolve(__dirname, "../../../../remotion-renderer");

/**
 * Logo sizing band, in pixels of the logo's LONGEST edge on the fixed 1080×1920
 * canvas. Expressed as a bounding box (not a fixed width) because logos are not
 * always square — some are wide wordmarks, some are tall crests. Sizing by width
 * alone would blow up a tall logo's height or squash a wide one, so the logo is
 * scaled to FIT inside a box of this size (objectFit: contain), preserving aspect
 * ratio for any shape. Codex previously got no size at all and defaulted to a
 * tiny logo. Corner watermarks sit near the minimum, hero logos (title/closing
 * cards) near the maximum. Tune via env without a redeploy.
 */
const LOGO_MIN_PX = Number(process.env.REEL_LOGO_MIN_PX ?? 128);
const LOGO_MAX_PX = Number(process.env.REEL_LOGO_MAX_PX ?? 320);

/** Per-attempt timeout for a Codex composition/edit/refine call (env-tunable). */
const COMPOSITION_TIMEOUT_MS = Number(process.env.CODEX_COMPOSITION_TIMEOUT_MS ?? 300_000);

/**
 * Safe-area margins (px) on the 1080×1920 canvas for TEXT / LOGO / GRAPHIC
 * elements — NOT for background media (full-bleed photos/videos still reach the
 * edges). Platform-aware per Instagram Reels: a large bottom margin clears the
 * caption/controls, the right margin clears the action buttons. And a minimum
 * font size so fine print stays legible on a phone. All env-tunable.
 */
const SAFE_TOP_PX = Number(process.env.REEL_SAFE_TOP_PX ?? 100);
const SAFE_SIDE_PX = Number(process.env.REEL_SAFE_SIDE_PX ?? 100);
const SAFE_RIGHT_PX = Number(process.env.REEL_SAFE_RIGHT_PX ?? 120);
const SAFE_BOTTOM_PX = Number(process.env.REEL_SAFE_BOTTOM_PX ?? 280);
const MIN_FONT_PX = Number(process.env.REEL_MIN_FONT_PX ?? 28);

/** Prompt block: safe-area padding + minimum legible font size. */
function motionEnergyGuidance(script: ReelScript): string {
  return [
    `MOTION & VISUAL ENERGY (this is what makes a reel feel alive — do NOT skimp):`,
    `- Animation style for this reel: ${script.animationStyle || "energetic, spring-driven"}. Express it in EVERY scene.`,
    `- NO scene may be static. Every scene needs an ENTRANCE and an EXIT animation — drive them with spring() (for snappy, physical motion) or interpolate() (for eased fades/slides). A scene that just appears and sits there is WRONG.`,
    `- IMAGES must always move: apply a continuous Ken Burns (slow scale 1.0→1.08 plus a gentle pan) for the scene's whole duration. A still image held perfectly still reads as a broken slideshow.`,
    `- TEXT must animate IN, not just fade: stagger words/lines, slide-up + fade, spring pop, letter-spacing settle, or a wipe/mask reveal. Title and closing cards especially deserve a designed, animated treatment — not centered text that fades in.`,
    `- VARY TRANSITIONS across the reel: do NOT use the same transition (e.g. cross-fade) for every scene. Mix the ones called for in the SCENES list (slide, wipe, whip-pan, dissolve, cut) using TransitionSeries so the pacing has rhythm.`,
    `- ADD A DESIGNED LAYER on top of the media — this is where "vibrant" comes from: gradient scrims, accent bars/shapes in palette colors, progress ticks, chips/labels, subtle grain/texture, depth via shadows. Decoration should animate too (slide/grow/fade), not sit frozen.`,
    `- Pace it to feel fast: prefer shorter holds with motion over long static holds. Energy comes from continuous movement, not from cramming content.`,
    `- Match the polish level of the EXAMPLE COMPOSITIONS below — they are the bar. If your reel has less motion and decoration than the examples, push it further.`,
  ].join("\n");
}

function layoutSafetyGuidance(): string {
  return [
    `SAFE AREA & TEXT LEGIBILITY (mobile — enforce strictly):`,
    `- Full-bleed background photos/videos MUST still fill the entire 1080×1920 frame edge-to-edge. The safe area below applies ONLY to TEXT, the LOGO, and GRAPHIC/UI elements (captions, cards, buttons, chips) — never to background media.`,
    `- Keep ALL text, the logo, and graphic elements within the safe area: ≥${SAFE_TOP_PX}px from the TOP, ≥${SAFE_SIDE_PX}px from the LEFT, ≥${SAFE_RIGHT_PX}px from the RIGHT, and ≥${SAFE_BOTTOM_PX}px from the BOTTOM. The large bottom margin keeps elements clear of the Instagram caption/controls; the right margin clears the action buttons. Nothing should ever sit flush to an edge.`,
    `- Easiest implementation: wrap your text/element layer in an AbsoluteFill with paddingTop:${SAFE_TOP_PX}, paddingLeft:${SAFE_SIDE_PX}, paddingRight:${SAFE_RIGHT_PX}, paddingBottom:${SAFE_BOTTOM_PX} (background media sits in a separate full-frame layer behind it, with NO padding).`,
    `- MINIMUM FONT SIZE: no text anywhere smaller than ${MIN_FONT_PX}px — this is a 1080px-wide canvas, so ${MIN_FONT_PX}px is already small on a phone. Captions/body text ≥36px; headlines much larger. NEVER render labels, credits, dates, or footnotes below ${MIN_FONT_PX}px.`,
    `- TEXT OVER MEDIA IS ENCOURAGED (it looks more designed than text banished to empty margins) — but ALWAYS put a legibility layer behind it so it never fights the photo: a gradient scrim (e.g. linear-gradient from transparent to rgba(0,0,0,0.55) at the text's edge), a solid/blurred color shape, or a chip. Place the text on the side AWAY from the subject (use the scene's focus point) so the scrim darkens empty space, not faces. With a scrim, text on top of the image is preferred over pushing all text outside the frame.`,
  ].join("\n");
}

/**
 * Contrast line for the logo, derived from a MEASURED profile (the composition
 * writer never sees the logo's pixels, so we hand it the fact). Without a profile
 * it falls back to a generic "ensure contrast" note.
 */
function logoContrastLine(profile?: LogoProfile): string {
  if (!profile || profile.requiredBackground === "any") {
    return profile
      ? `- CONTRAST: the logo carries its own background, so it stays legible on any surface — just give it a little breathing room.`
      : `- CONTRAST: make sure the logo is clearly legible against whatever is behind it; if in doubt, put it on a small white rounded chip.`;
  }
  const desc = `${profile.tone}${profile.hasTransparency ? " with transparency" : ""}`;
  if (profile.requiredBackground === "light") {
    return `- CONTRAST (measured): this logo is ${desc}, so it is INVISIBLE on dark backgrounds. It MUST sit on a LIGHT / WHITE surface — place it on a white (or very light) rounded chip, or on a light area of the frame. NEVER put it on a dark header bar, dark gradient, or dark photo region.`;
  }
  return `- CONTRAST (measured): this logo is ${desc}, so it is INVISIBLE on light backgrounds. It MUST sit on a DARK surface — place it on a dark rounded chip, or on a dark area of the frame. NEVER put it on a white / light background.`;
}

/**
 * Audio-mix guidance: when a scene's clip has speech, play the clip's own audio
 * and duck the background music so the speaker is clearly audible.
 */
function audioMixGuidance(script: ReelScript, hasMusic: boolean): string {
  const videoScenes = script.scenes.filter((s) => s.mediaType === "video");
  const speechScenes = videoScenes.filter((s) => s.containsSpeech);
  // The creative director's intent wins. Default for older scripts without the
  // field: voice mode only if speech scenes exist, else bgm-only.
  const style: "bgm-only" | "voice-led" | "mixed" =
    script.audioStyle ?? (speechScenes.length > 0 ? "mixed" : "bgm-only");

  // BGM-only: visuals/activity carry it. Mute everything, music plays full —
  // ignore any incidental talking in the clips.
  if (style === "bgm-only" || speechScenes.length === 0) {
    return [
      `AUDIO MIX — this reel is BGM-ONLY (carried by visuals/activity):`,
      `- Mute EVERY <Video> (visual only) — add the \`muted\` prop on all of them. Ignore any incidental talking in the clips; it is not the point of this reel.`,
      hasMusic
        ? `- The background music plays at a normal/full level the WHOLE time — no ducking.`
        : `- There is no music track.`,
    ].join("\n");
  }

  // voice-led / mixed: the speakers must be heard.
  const lines = [
    `AUDIO MIX — this reel is ${style.toUpperCase()} (the speakers must be heard):`,
    `- Scenes marked 🔊 SPEECH contain talking. On those scenes the <Video> MUST play its OWN audio — do NOT put the \`muted\` prop on them. Mute all OTHER videos (visual only).`,
  ];
  if (hasMusic) {
    lines.push(
      `- DUCK the background music during every SPEECH scene so the voice cuts through: drop music volume to ~0.12 for those frames, ~0.8 elsewhere. Use a frame-based volume function on the music <Audio>:`,
      `    const SPEECH_RANGES = [[startFrame, endFrame], ...]; // each SPEECH scene's frame range (seconds × 30)`,
      `    const ducked = (f) => SPEECH_RANGES.some(([a, b]) => f >= a && f < b);`,
      `    <Audio src={staticFile("music/track.mp3")} volume={(f) => ducked(f) ? 0.12 : 0.8} />`,
      `  Compute SPEECH_RANGES from where each SPEECH scene sits in your timeline; add a short ~8-frame ramp at each edge so the duck eases in/out instead of clicking.`,
    );
    if (style === "voice-led") {
      lines.push(`- VOICE-LED: the message is in the words. Keep music as a quiet bed (~0.15 baseline) the WHOLE time, dropping to ~0.08 under speech; let it rise only on the title/closing cards. Voices lead; music merely supports.`);
    }
  } else {
    lines.push(`- There is no music track — just make sure the SPEECH clips play their own audio.`);
  }
  return lines.join("\n");
}

/** Prompt block describing how big the logo must be rendered + contrast. */
function logoSizingGuidance(profile?: LogoProfile): string {
  const minPct = Math.round((LOGO_MIN_PX / 1080) * 100);
  const maxPct = Math.round((LOGO_MAX_PX / 1080) * 100);
  const mid = Math.round((LOGO_MIN_PX + LOGO_MAX_PX) / 2);
  return [
    `LOGO SIZE & TREATMENT (CRITICAL — the logo keeps rendering too small / invisible; fix it):`,
    `- The logo may be SQUARE or RECTANGULAR (a wide wordmark, or a tall crest). Do NOT assume square.`,
    `- Apply the size to the LOGO <Img> ITSELF — NEVER to a wrapping card. The VISIBLE logo's LONGEST edge MUST measure ${LOGO_MIN_PX}px–${LOGO_MAX_PX}px on the 1080px canvas (≈${minPct}%–${maxPct}%), never below ${LOGO_MIN_PX}px. Exact CSS, directly on the Img:`,
    `    <Img src={staticFile("media/logo.png")} style={{ width: "auto", height: "auto", maxWidth: <box>, maxHeight: <box>, objectFit: "contain" }} />`,
    `  This makes a WIDE logo's WIDTH ≈ <box> and a TALL logo's HEIGHT ≈ <box>. That is the intended size — correct, not "too small".`,
    `- DO NOT put the logo inside a large square card/box with padding around it, and DO NOT force a rectangular logo into a square frame. A logo letterboxed inside a padded square looks tiny — that is the EXACT bug we are fixing. No decorative card, no big padding.`,
    logoContrastLine(profile),
    `- If a backing is needed for contrast, it must HUG the logo: a tight rounded-rect with ≤12px uniform padding, matching the logo's own shape — never a big empty square with the logo floating small in the middle.`,
    `- Corner / persistent watermark: longest edge near ${LOGO_MIN_PX}–${mid}px. Hero logo (title card / closing card): longest edge near ${mid}–${LOGO_MAX_PX}px — USE THE UPPER END, there is plenty of empty space on those cards.`,
    `- Keep a ≥40px safe-area margin from the frame edges. Never stretch or distort the logo.`,
  ].join("\n");
}

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
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  /** Whether a logo file is available in media/. */
  hasLogo: boolean;
  /** Measured logo tone/transparency so the writer can guarantee contrast. */
  logoProfile?: LogoProfile;
  /** Whether a footer image is available in media/. */
  hasFooter?: boolean;
  /** Whether a music file is available in music/. */
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? COMPOSITION_TIMEOUT_MS; // 5 minutes
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
    const orient = (info: { type: string; orientation?: string }) =>
      info.type === "video" && info.orientation ? ` [${info.orientation.toUpperCase()}]` : "";
    const mediaLines: string[] = [];
    for (const [filename, info] of input.mediaManifest) {
      mediaLines.push(`- media/${filename} (${info.type})${orient(info)} — ${info.description}`);
    }
    if (input.hasLogo) mediaLines.push(`- media/logo.png (image) — school logo`);
    if (input.hasFooter) mediaLines.push(`- media/footer.png (image) — school footer/branding strip`);
    if (input.hasMusic) mediaLines.push(`- music/track.mp3 (audio) — background music`);

    // Load helpers.ts so Codex knows what's available
    const helpers = await fs.readFile(
      path.join(REMOTION_RENDERER_DIR, "scaffold", "helpers.ts"),
      "utf8",
    ).catch(() => "");

    const prompt = buildPrompt(input.script, mediaLines, readme, exampleContents, helpers, input.hasLogo, input.logoProfile, input.hasMusic);

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
export function generateFallbackComposition(
  script: ReelScript,
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>,
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
  hasLogo: boolean,
  logoProfile?: LogoProfile,
  hasMusic = false,
): string {
  return `You are writing a Remotion composition (React/TypeScript component) for an Instagram Reel video.

Build the reel's VISUAL IDENTITY from the CREATIVE DIRECTION, COLOR PALETTE, and
TYPOGRAPHY below — that is the binding spec for COLORS, FONTS, TEXT, and MEDIA. The
example compositions near the end are your CRAFT reference: borrow their motion design,
layering, transitions, and decorative energy, then reskin them with this reel's identity.
Aim high — a flat, static result is a failure even if the colors and fonts are correct.

## CREATIVE DIRECTION (the BINDING spec for how this reel must look — build THIS, from scratch)
- Direction: ${script.direction}
- Visual Register: ${script.visualRegister}
- Theme: ${script.theme}
- Animation Style: ${script.animationStyle}

## COLOR PALETTE (use these EXACT hex values — do NOT substitute any example's colors)
${script.colorPalette.map((c) => `  ${c}`).join("\n")}

## TYPOGRAPHY (use these EXACT fonts — do NOT substitute any example's fonts)
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
  if (s.mediaType === "video" && s.containsSpeech) line += ` 🔊 SPEECH (play clip audio, duck music)`;
  line += ` — focus: ${s.focusX}%,${s.focusY}% (subject is ${s.focusY <= 40 ? "TOP" : s.focusY >= 60 ? "BOTTOM" : "CENTER"} → place text ${s.focusY <= 40 ? "at BOTTOM" : "at TOP"})`;
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
${hasLogo ? logoSizingGuidance(logoProfile) : ""}

## MEDIA FILES AVAILABLE
${mediaLines.join("\n")}

## REMOTION API REFERENCE
${apiRef}

## AVAILABLE HELPERS (import from "./helpers")
\`\`\`tsx
${helpers}
\`\`\`

## MOTION & VISUAL ENERGY
${motionEnergyGuidance(script)}

## EXAMPLE COMPOSITIONS — YOUR CRAFT REFERENCE (borrow the motion & layout craft; reskin the content)
These are polished, hand-built reels. They are your bar for quality. STUDY them and
BORROW their craft — this is where the vibrancy comes from:
- their MOTION: spring()-driven entrances/exits, staggered reveals, parallax, scale/zoom,
  beat-synced word stamps, animated counters — reuse these techniques liberally.
- their LAYOUT CRAFT & STRUCTURE: how they layer media + scrims + type + decorative shapes,
  how they frame photos, how they compose title/closing cards, how they use negative space.
- their TRANSITIONS: TransitionSeries usage, slides/wipes/whip-pans/dissolves — vary them.
- their DECORATIVE ENERGY: gradient overlays, accent bars, tape/stickers/chips, texture,
  motion-blur, shadow depth — the "designed" feel. Adapt these to THIS reel's register.

Think of it as RE-SKINNING a great template, not avoiding it: take a layout/motion pattern
you like, then swap in THIS reel's identity. ONLY these four things must come from the spec
above, never from an example:
- COLORS → use the COLOR PALETTE above (those exact hex values), not the example's colors
- FONTS → use the TYPOGRAPHY above, not the example's fonts
- TEXT / copy → use the SCENES + title/closing cards above, not the example's words
- MEDIA → use the MEDIA FILES listed above, not the example's photos
Everything else — motion design, layering, decoration, structural layout — you SHOULD lift and
adapt. A flat result (centered text on a plain background, every scene a simple cross-fade, no
decorative layer, no spring motion) is a FAILURE even if the palette/fonts are correct. Match
the example's level of motion and polish, expressed in THIS reel's register, palette, and fonts.

${examples.join("\n\n")}

## LAYOUT SAFETY & LEGIBILITY
${layoutSafetyGuidance()}

## AUDIO MIX
${audioMixGuidance(script, hasMusic)}

## RULES
1. Export a React.FC named "Reel" and a number constant "REEL_DURATION" (total frames at 30fps)
2. Use only these packages: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions
3. Media files: use staticFile("media/filename.ext") — NEVER include "public/" in the path. staticFile() resolves relative to the public/ folder automatically. CORRECT: staticFile("media/photo.jpg"). WRONG: staticFile("public/media/photo.jpg")
4. Music: use staticFile("music/track.mp3")
5. Canvas: 1080×1920 pixels, 30fps — ALWAYS
6. Include school branding (logo, name) as described above — the logo MUST respect the LOGO SIZE bounds in the BRANDING section (never render it tiny)
7. Respect the LAYOUT SAFETY rules above: text/logo/graphics inside the safe-area margins (≥${SAFE_TOP_PX}px top, ≥${SAFE_SIDE_PX}px sides, ≥${SAFE_RIGHT_PX}px right, ≥${SAFE_BOTTOM_PX}px bottom), and NO text smaller than ${MIN_FONT_PX}px. Background media stays full-bleed.
8. Write COMPLETE, COMPILABLE TypeScript — every import, every type, every component
9. ONLY use files listed in "MEDIA FILES AVAILABLE" above — do NOT reference any other filenames. If a file is not listed, it does NOT exist. Do NOT use external assets or URLs.
10. CRITICAL — VIDEO FILES: Files listed as "(video)" MUST use the <Video> component from "@remotion/media", NOT <Img>.
   import { Video } from "@remotion/media";
   The video element has NO intrinsic size in this renderer — if you do not give it an explicit
   width AND height it renders at the clip's native resolution and overflows/misaligns the 9:16 frame.
   So a full-bleed video MUST set BOTH width:"100%" and height:"100%" in style, AND objectFit="cover"
   as a PROP (never objectFit inside style — @remotion/media warns and it is the wrong API). The
   <Video> must be a child of an <AbsoluteFill> or an absolutely-positioned full-size box (1080×1920),
   never a div that lacks an explicit size. Use objectPosition (in style) for the focal point.
   AUDIO: add the \`muted\` prop on videos that are NOT marked 🔊 SPEECH (visual only). For SPEECH
   scenes, OMIT \`muted\` so the speaker's voice plays, and duck the music (see AUDIO MIX above).
   CORRECT full-bleed example (non-speech → muted):
     <AbsoluteFill>
       <Video
         src={staticFile("media/clip.mp4")}
         muted
         trimBefore={Math.round(startSec * 30)}
         trimAfter={Math.round(endSec * 30)}
         objectFit="cover"
         style={{ width: "100%", height: "100%", objectPosition: \`\${focusX}% \${focusY}%\` }}
       />
     </AbsoluteFill>
   VIDEO TREATMENT — CHOOSE per clip; there is NO single mandated treatment. A media file tagged
   [LANDSCAPE]/[PORTRAIT]/[SQUARE] in the list tells you its shape — pick the treatment that shows
   it WELL rather than cropping the subject away. Your options (all valid — use whichever the
   creative direction + the clip's shape call for):
     a) FULL-BLEED COVER — <Video> fills 1080×1920 via objectFit="cover" (style width/height 100%),
        objectPosition at the focal point. Great for PORTRAIT/vertical clips. For a LANDSCAPE clip
        this crops away ~60% of the width — only do it when the subject is dead-center.
     b) FRAMED — the <Video> sits in a card/box with breathing room. The media box needs a DEFINITE
        size (pixel height/width or aspectRatio + overflow:"hidden"); inside it the <Video> is
        width/height 100% + objectFit="cover". Pick a box shape that matches the clip (a LANDSCAPE
        clip in a ~16:9 / ~3:2 card crops very little).
     c) BLUR-FILL BACKDROP (best for LANDSCAPE in this vertical frame) — show the WHOLE clip, no
        cropped-out faces, no ugly bars: a back layer = the SAME video scaled up + heavily blurred
        to cover 1080×1920, and a front layer = the same video fit to width (objectFit="contain")
        centered. Example:
          <AbsoluteFill>
            <Video src={staticFile("media/clip.mp4")} muted objectFit="cover"
              style={{ width:"100%", height:"100%", filter:"blur(40px)", transform:"scale(1.2)" }} />
            <AbsoluteFill style={{ display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Video src={staticFile("media/clip.mp4")} muted objectFit="contain"
                style={{ width:"100%", height:"100%" }} />
            </AbsoluteFill>
          </AbsoluteFill>
        (Use the SAME trimBefore/trimAfter on both layers. For a SPEECH clip, keep \`muted\` on the
        blurred back layer and OMIT it on the sharp front layer so the voice plays once.)
     d) LETTERBOX / designed bars — fit-to-width with intentional solid/gradient bands (in palette
        colours) above and below, used as a deliberate design element (captions/branding can live
        in the bands). This is NOT a bug — empty-looking gaps are only wrong when they are accidental.
   The earlier "video must fill its box, no gaps" rule applies ONLY to treatment (b); treatments
   (c) and (d) intentionally show the whole frame and are fully allowed.
   TRIMMING: use trimBefore / trimAfter (values in FRAMES, = seconds × 30). The props startFrom / endAt
   do NOT exist on @remotion/media's <Video> and are silently ignored — never use them.
   Image files (.jpg, .png) use <Img> from "remotion"; for images objectFit IN style is fine.
   NEVER use <Img> for a .mp4/.mov file. NEVER use <Video> for a .jpg/.png file.
11. Load Google Fonts via @remotion/google-fonts (e.g., import { loadFont } from "@remotion/google-fonts/Poppins")
12. Calculate REEL_DURATION precisely from your timing constants
13. TEXT PLACEMENT — NEVER cover the subject, and stay inside the safe area:
   - Each scene has focusX/focusY values (0-100) indicating where the subject is.
   - If focusY <= 40 (subject at top): place text LOW — but ABOVE the ${SAFE_BOTTOM_PX}px bottom safe margin (never in the bottom danger zone).
   - If focusY >= 60 (subject at bottom): place text HIGH — but BELOW the ${SAFE_TOP_PX}px top safe margin.
   - If focusY is 40-60 (centered): place text high or low (within the safe area), NEVER dead-center over the subject.
   - For full-bleed scenes: use a gradient overlay (transparent→dark) on the side WHERE TEXT IS,
     to ensure readability without covering the subject on the opposite side.
   - For framed scenes: place text OUTSIDE the photo frame (above/below the card) OR over the media on the side away from the subject with a scrim/chip behind it — whichever looks more designed.
   - Text should be SHORT (3-6 words). Long text blocks = more photo coverage = bad.

OUTPUT FORMAT:
Write the COMPLETE Reel.tsx file inside a single \`\`\`tsx code fence.
If you also need a separate data.ts, write it in a second \`\`\`tsx fence labeled "data.ts".

BEGIN:`;
}

/**
 * Extract Reel.tsx (and optionally data.ts) code from Codex output.
 * Looks for ```tsx code fences.
 */
function sanitizeStaticFilePaths(code: string): string {
  return code.replace(/staticFile\(\s*["']public\//g, 'staticFile("');
}

function extractCode(raw: string): CompositionCode {
  const fences = [...raw.matchAll(/```(?:tsx?)\s*\n([\s\S]*?)```/g)];

  if (fences.length === 0) {
    if (raw.includes("export") && raw.includes("Reel")) {
      return { reelTsx: sanitizeStaticFilePaths(raw) };
    }
    return { reelTsx: "" };
  }

  const reelTsx = sanitizeStaticFilePaths(fences[0][1].trim());
  const dataTsx = fences.length > 1 ? sanitizeStaticFilePaths(fences[1][1].trim()) : undefined;

  return { reelTsx, dataTsx };
}

/**
 * Pick 2 example files: the BEST match for the visual register (so the model
 * sees the right Remotion technique for this style) AND a deliberately DIFFERENT
 * one. Showing two unlike examples stops the model from cloning a single template
 * and reinforces that technique transfers across styles — the visual identity must
 * come from the ReelScript, not from any one example.
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
    ["bold-overlay.md", scoreMatch(lower, ["bold", "overlay", "full", "bleed", "gradient", "impact", "motivational", "highlight", "announcement"])],
    ["cinematic-letterbox.md", scoreMatch(lower, ["cinematic", "letterbox", "widescreen", "movie", "trailer", "atmospheric", "premium", "campus", "tour"])],
    ["story-slides.md", scoreMatch(lower, ["story", "stories", "instagram", "sticker", "casual", "fun", "gen-z", "colorful", "swipe", "playful"])],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  const exists = (file: string) =>
    fs.stat(path.join(examplesDir, file)).then(() => true).catch(() => false);

  const picked: string[] = [];
  // 1) Best match — the right technique for this register.
  for (const [file] of scores) {
    if (await exists(file)) { picked.push(file); break; }
  }
  // 2) Most DIFFERENT existing example — breaks single-template cloning.
  for (let i = scores.length - 1; i >= 0; i--) {
    const file = scores[i][0];
    if (picked.includes(file)) continue;
    if (await exists(file)) { picked.push(file); break; }
  }
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
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  hasLogo: boolean;
  logoProfile?: LogoProfile;
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? COMPOSITION_TIMEOUT_MS;
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

CREATIVE DIRECTION — this is the spec the render MUST match (fix any drift from it):
- Direction: ${input.script.direction}
- Visual Register: ${input.script.visualRegister}
- Theme: ${input.script.theme}
- COLOUR PALETTE (use these EXACT hex values — if the render drifted to other colours, correct it): ${input.script.colorPalette.join(", ")}
- TYPOGRAPHY (use these EXACT fonts): heading ${input.script.typography.heading}, body ${input.script.typography.body}${input.script.typography.accent ? `, accent ${input.script.typography.accent}` : ""}

RULES:
1. Fix the specific weaknesses listed above. If the feedback flags palette/font/register DRIFT (the render used the wrong colours/fonts), that is the FIRST thing to correct — make the colours and fonts match the spec above exactly.
2. BUT if the feedback says the result is FLAT, MUTED, LIFELESS, STATIC, GENERIC, or LOW-ENERGY, do NOT just re-apply the same palette — that will not fix it. You MAY and SHOULD push the design BOLDER than the brief: deepen/saturate the palette, add strong light/dark contrast and vivid accent colours, add gradients/scrims/accent shapes/texture, and add or intensify MOTION (spring entrances/exits, continuous Ken Burns on images, animated text, varied transitions). Staying on-brand matters (keep at least one brand colour), but VIBRANCY beats literal palette adherence here. A refine that comes back equally flat is a failure.
3. Keep the same overall creative direction and structure; do NOT regress to a generic/stock look.
4. Export "Reel" (React.FC) and "REEL_DURATION" (number in frames)
5. Canvas: 1080x1920, 30fps. Keep text/logo/graphics within the safe area (≥${SAFE_TOP_PX}px top, ≥${SAFE_SIDE_PX}px sides, ≥${SAFE_RIGHT_PX}px right, ≥${SAFE_BOTTOM_PX}px bottom); no text below ${MIN_FONT_PX}px; logo sized to its bounds (never tiny, never in a big padded square).
${input.hasLogo ? `6. LOGO CONTRAST: ${logoContrastLine(input.logoProfile).replace(/^- /, "")}` : ""}
7. Use only: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions
8. Media paths: use staticFile("media/filename.ext") and staticFile("music/track.mp3") — NEVER include "public/" in the path
9. Write COMPLETE, COMPILABLE TypeScript

OUTPUT: Write the COMPLETE improved Reel.tsx inside a single \`\`\`tsx code fence.

BEGIN:`;

    console.log(`[Refine] Asking Codex to fix composition — ${prompt.length} chars`);
    const code = await runCodexForCode("Refine", prompt, workDir, timeoutMs);
    console.log(`[Refine] Got ${code.reelTsx.length} chars refined Reel.tsx`);
    return code;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Repair a composition that failed to COMPILE or RENDER. Unlike refinement
 * (which improves an already-working reel based on visual feedback), this feeds
 * the exact bundler/render error back to Codex and asks for the minimal fix.
 */
export async function repairComposition(input: {
  originalCode: string;
  /** The compile/render error message from the renderer. */
  errorMessage: string;
  script: ReelScript;
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  hasLogo: boolean;
  logoProfile?: LogoProfile;
  hasFooter?: boolean;
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? COMPOSITION_TIMEOUT_MS;
  const workDir = path.join(os.tmpdir(), "codex-repair", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const mediaLines: string[] = [];
  for (const [filename, info] of input.mediaManifest) {
    mediaLines.push(`- media/${filename} (${info.type})`);
  }
  if (input.hasLogo) mediaLines.push(`- media/logo.png (image)`);
  if (input.hasFooter) mediaLines.push(`- media/footer.png (image)`);
  if (input.hasMusic) mediaLines.push(`- music/track.mp3 (audio)`);

  try {
    const prompt = `You are fixing a Remotion composition (React/TypeScript) for an Instagram Reel that FAILED to compile/render.

The renderer reported this error:
\`\`\`
${input.errorMessage}
\`\`\`

Here is the current Reel.tsx that produced the error:

\`\`\`tsx
${input.originalCode}
\`\`\`

THE ONLY FILES THAT EXIST (referencing anything else will fail the render):
${mediaLines.join("\n") || "(none)"}

FIX RULES — make the SMALLEST change that resolves the error, keep the creative design intact:
1. Diagnose the error above and fix its ROOT CAUSE. Do NOT rewrite the whole composition.
2. Export "Reel" (React.FC) and "REEL_DURATION" (number, total frames at 30fps). Canvas 1080×1920, 30fps.
3. Use ONLY: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions.
4. staticFile("media/<file>") / staticFile("music/track.mp3") — NEVER prefix with "public/".
5. ONLY reference files in the list above. If the error is a missing/unknown file, remove that reference or swap it for a listed file — do NOT invent filenames.
6. VIDEO (.mp4/.mov) uses <Video> from "@remotion/media" with style={{ width:"100%", height:"100%", objectPosition:"X% Y%" }} and objectFit="cover" as a PROP (never objectFit in style). Trim with trimBefore/trimAfter (frames = sec×30); startFrom/endAt do NOT exist. Images use <Img> from "remotion".
7. The result must be COMPLETE, COMPILABLE TypeScript — every import, type, and component present.

OUTPUT: the COMPLETE corrected Reel.tsx inside a single \`\`\`tsx code fence.

BEGIN:`;

    const outFile = path.join(workDir, "out.txt");
    console.log(`[Repair] Asking Codex to fix render error — ${prompt.length} chars prompt`);

    await runCodexCapture(prompt, outFile, workDir, timeoutMs);
    const raw = (await fs.readFile(outFile, "utf8")).trim();
    if (!raw) throw new Error("Codex returned empty repair output");

    const code = extractCode(raw);
    if (!code.reelTsx) throw new Error("Could not extract repaired Reel.tsx");

    console.log(`[Repair] Got ${code.reelTsx.length} chars repaired Reel.tsx`);
    return code;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Render a composition with self-correction. On a compile/render failure, feeds
 * the error back to Codex (repairComposition) and retries, finally falling back
 * to the guaranteed-valid slideshow. Shared by initial generation and chat-edit
 * so both paths get identical resilience. Caller uploads + cleans up the result.
 */
export async function renderWithRepair(input: {
  composition: CompositionCode;
  script: ReelScript;
  assets: RenderAssets;
  maxAttempts?: number;
  /** Log prefix, e.g. "V1" or "edit r3". */
  label?: string;
}): Promise<{ renderResult: RenderResult; composition: CompositionCode; usedFallback: boolean }> {
  const { renderReel } = await import("@/lib/remotion/render");
  const { script, assets } = input;
  const maxAttempts = input.maxAttempts ?? 3;
  const tag = input.label ? `${input.label} — ` : "";
  let composition = input.composition;

  const doRender = (c: CompositionCode) =>
    renderReel({
      reelTsx: c.reelTsx,
      dataTsx: c.dataTsx,
      mediaFiles: assets.mediaFiles,
      musicFile: assets.musicFile,
    });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[render-repair] ${tag}render attempt ${attempt}/${maxAttempts}`);
    try {
      const renderResult = await doRender(composition);
      return { renderResult, composition, usedFallback: false };
    } catch (renderErr) {
      const msg = renderErr instanceof Error ? renderErr.message : String(renderErr);
      console.warn(`[render-repair] ${tag}attempt ${attempt} FAILED: ${msg}`);

      if (attempt < maxAttempts) {
        try {
          console.log(`[render-repair] ${tag}asking Codex to repair`);
          composition = await repairComposition({
            originalCode: composition.reelTsx,
            errorMessage: msg,
            script,
            mediaManifest: assets.mediaManifest,
            hasLogo: assets.hasLogo,
            hasFooter: assets.hasFooter,
            hasMusic: assets.hasMusic,
          });
          continue;
        } catch (repairErr) {
          console.warn(`[render-repair] ${tag}repair unavailable (${repairErr instanceof Error ? repairErr.message : repairErr})`);
        }
      }

      // Exhausted (or repair failed) → guaranteed-valid slideshow.
      console.warn(`[render-repair] ${tag}falling back to slideshow generator`);
      composition = generateFallbackComposition(script, assets.mediaManifest, assets.hasMusic);
      const renderResult = await doRender(composition);
      return { renderResult, composition, usedFallback: true };
    }
  }
  throw new Error("renderWithRepair: exhausted attempts without a result");
}

/**
 * Apply a user's chat-edit instruction to a working composition. Unlike repair
 * (driven by an error) or refine (driven by visual feedback), this makes the
 * specific change the user asked for while keeping everything else intact.
 */
export async function editComposition(input: {
  originalCode: string;
  /** The user's natural-language edit request. */
  instruction: string;
  script: ReelScript;
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  hasLogo: boolean;
  logoProfile?: LogoProfile;
  hasFooter?: boolean;
  hasMusic: boolean;
  timeoutMs?: number;
}): Promise<CompositionCode> {
  const timeoutMs = input.timeoutMs ?? COMPOSITION_TIMEOUT_MS;
  const workDir = path.join(os.tmpdir(), "codex-edit", `${process.pid}-${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  const mediaLines: string[] = [];
  for (const [filename, info] of input.mediaManifest) {
    const orientTag = info.type === "video" && info.orientation ? ` [${info.orientation.toUpperCase()}]` : "";
    mediaLines.push(`- media/${filename} (${info.type})${orientTag} — ${info.description}`);
  }
  if (input.hasLogo) mediaLines.push(`- media/logo.png (image)`);
  if (input.hasFooter) mediaLines.push(`- media/footer.png (image)`);
  if (input.hasMusic) mediaLines.push(`- music/track.mp3 (audio)`);

  try {
    const prompt = `You are editing a WORKING Remotion composition (React/TypeScript) for an Instagram Reel based on a user's request. Apply ONLY the requested change; keep everything else (structure, other scenes, branding, timing not affected) intact.

USER'S EDIT REQUEST:
"${input.instruction}"

CURRENT Reel.tsx:
\`\`\`tsx
${input.originalCode}
\`\`\`

THE ONLY FILES THAT EXIST (referencing anything else will fail the render):
${mediaLines.join("\n") || "(none)"}

AUDIO MIX REFERENCE (apply if the request touches music/voice/BGM/ducking):
${audioMixGuidance(input.script, input.hasMusic)}

RULES:
1. Make the smallest change that satisfies the request. Do NOT redesign unrelated parts.
2. Export "Reel" (React.FC) and "REEL_DURATION" (number, total frames at 30fps). If you add/remove scenes, recompute REEL_DURATION exactly.
3. Use ONLY: remotion, @remotion/media, @remotion/google-fonts, @remotion/transitions.
4. staticFile("media/<file>") / staticFile("music/track.mp3") — NEVER prefix with "public/". Only reference files in the list above.
5. VIDEO (.mp4/.mov) uses <Video> from "@remotion/media" with style={{ width:"100%", height:"100%", objectPosition:"X% Y%" }} and objectFit="cover" as a PROP (never objectFit in style). Trim with trimBefore/trimAfter (frames = sec×30); startFrom/endAt do NOT exist. Images use <Img> from "remotion".
6. The result must be COMPLETE, COMPILABLE TypeScript.
${input.hasLogo ? `7. If the logo is shown, size the LOGO <Img> ITSELF (not a wrapping card) so its longest visible edge is ${LOGO_MIN_PX}px–${LOGO_MAX_PX}px on the 1080px canvas (never tiny). Use width/height:"auto" + maxWidth/maxHeight + objectFit:"contain". The logo may be rectangular — do NOT box it inside a padded square card (that letterboxes it and makes it look tiny).\n${logoContrastLine(input.logoProfile)}` : ""}
8. Keep text/logo/graphics inside the safe area (≥${SAFE_TOP_PX}px top, ≥${SAFE_SIDE_PX}px sides, ≥${SAFE_RIGHT_PX}px right, ≥${SAFE_BOTTOM_PX}px bottom) and use NO font smaller than ${MIN_FONT_PX}px. Background media stays full-bleed (no padding on it).

OUTPUT: the COMPLETE updated Reel.tsx inside a single \`\`\`tsx code fence.

BEGIN:`;

    console.log(`[Edit] Asking Codex to apply edit — ${prompt.length} chars prompt`);
    const code = await runCodexForCode("Edit", prompt, workDir, timeoutMs);
    console.log(`[Edit] Got ${code.reelTsx.length} chars edited Reel.tsx`);
    return code;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Spawn codex exec, write prompt to stdin, capture output to file. */
/**
 * Run a Codex code-generation call with ONE retry, returning the extracted code.
 * Edit/refine were single-shot, so a transient Codex stall (network blip, backend
 * hiccup → the 300s timeout) killed the whole operation. Generation already
 * retries; this gives edit/refine the same resilience. The 2nd attempt usually
 * lands after the blip clears. Stops early on a usage-limit (retry won't help).
 */
async function runCodexForCode(
  label: string,
  prompt: string,
  workDir: string,
  timeoutMs: number,
): Promise<CompositionCode> {
  const outFile = path.join(workDir, "out.txt");
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runCodexCapture(prompt, outFile, workDir, timeoutMs);
      const raw = (await fs.readFile(outFile, "utf8")).trim();
      if (!raw) throw new Error("Codex returned empty output");
      const code = extractCode(raw);
      if (!code.reelTsx) throw new Error("Could not extract Reel.tsx from Codex output");
      return code;
    } catch (err) {
      lastErr = err;
      console.warn(`[${label}] attempt ${attempt}/2 failed: ${err instanceof Error ? err.message : err}`);
      if (err instanceof CodexUsageLimitError) break; // retrying a quota error is pointless
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

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
      if (code === 0) return resolve();
      const { message, usageLimit } = extractCodexError(stderr);
      if (usageLimit) reject(new CodexUsageLimitError(`Codex usage limit reached — ${message}`));
      else reject(new Error(`codex exec (composition) exited ${code}: ${message}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
