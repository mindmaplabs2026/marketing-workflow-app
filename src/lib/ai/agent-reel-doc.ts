/**
 * generateReelDoc — produces a validated ReelDoc (structured scene graph, Tier 2)
 * from a ReelScript. Two sources:
 *   1. Codex emits the ReelDoc as JSON (creative layout), zod-validated with a retry.
 *   2. Deterministic scriptToReelDoc() — a reliable layout realization of the script,
 *      used as the fallback when Codex's JSON won't validate. It always produces a
 *      valid doc, so schema mode never hard-fails.
 *
 * The renderer (remotion-renderer/schema/SchemaReel.tsx) turns the doc into video.
 * Media is referenced as "media/<file>" / "music/track.mp3" (staticFile, no prefix),
 * matching how the render orchestrator lays files into public/.
 */
import "server-only";
import { ReelDocSchema, collectMediaSrcs, type ReelDoc, type ReelDocElement } from "./reel-doc";
import type { ReelScript, SceneBeat } from "./agent-creative-reel";
import type { LogoProfile } from "./logo-analysis";
import { codexText, stripJsonFences } from "./codex-text";

const FPS = 30;
const W = 1080;
const H = 1920;
// Safe-area margins as % of canvas (env is px on the 1080x1920 canvas).
const SAFE_TOP = (Number(process.env.REEL_SAFE_TOP_PX ?? 100) / H) * 100;
const SAFE_SIDE = (Number(process.env.REEL_SAFE_SIDE_PX ?? 100) / W) * 100;
const SAFE_BOTTOM = (Number(process.env.REEL_SAFE_BOTTOM_PX ?? 280) / H) * 100;
const MIN_FONT = Number(process.env.REEL_MIN_FONT_PX ?? 28);

export type ReelDocInput = {
  script: ReelScript;
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  hasLogo: boolean;
  hasFooter: boolean;
  hasMusic: boolean;
  logoProfile?: LogoProfile;
  timeoutMs?: number;
};

const sec2frames = (s: number) => Math.max(1, Math.round((s || 0) * FPS));

/**
 * Enforce the reel's audio intent on the doc's video clips. `bgm-only` mutes every
 * clip so only the BGM is heard (clips otherwise play their own voices/noise ON TOP
 * of the BGM — the #1 audio complaint). `voice-led`/`mixed` leave clip audio audible
 * (the BGM is ducked via music.gainDb elsewhere). Applied to BOTH the deterministic
 * and Codex docs so the policy holds regardless of what the model emitted.
 */
function applyAudioPolicy(doc: ReelDoc, audioStyle: string | undefined): ReelDoc {
  const muteClips = audioStyle === "bgm-only";
  for (const scene of doc.scenes) {
    for (const el of scene.elements) {
      if (el.type === "video") el.mute = muteClips;
    }
  }
  return doc;
}
const basename = (p: string) => p.split("/").pop() ?? p;

function mediaFilename(beat: SceneBeat, manifest: ReelDocInput["mediaManifest"]): string | null {
  const fn = basename(beat.mediaPath);
  return manifest.has(fn) ? fn : null;
}

function kenBurnsFor(beat: SceneBeat): { from: number; to: number; panX?: number; panY?: number } | undefined {
  if (!beat.kenBurns) return undefined;
  const amt = beat.kenBurns.intensity === "dramatic" ? 0.2 : beat.kenBurns.intensity === "moderate" ? 0.12 : 0.06;
  switch (beat.kenBurns.direction) {
    case "in": return { from: 1.0, to: 1 + amt };
    case "out": return { from: 1 + amt, to: 1.0 };
    case "left": return { from: 1 + amt, to: 1 + amt, panX: -amt * 40 };
    case "right": return { from: 1 + amt, to: 1 + amt, panX: amt * 40 };
    default: return { from: 1.0, to: 1 + amt };
  }
}

function transitionFor(t: SceneBeat["transition"]): { type: "fade" | "slideL" | "slideR" | "wipe" | "none"; durationInFrames: number } | undefined {
  switch (t) {
    case "cut": return undefined;
    case "wipe": return { type: "wipe", durationInFrames: 12 };
    case "slide": case "whippan": return { type: "slideL", durationInFrames: 14 };
    default: return { type: "fade", durationInFrames: 15 }; // fade / dissolve
  }
}

/** Deterministic ReelScript → ReelDoc. Reliable baseline + fallback. */
export function scriptToReelDoc(input: ReelDocInput): ReelDoc {
  const { script, mediaManifest, hasLogo, hasFooter } = input;
  const palette = script.colorPalette?.length ? script.colorPalette : ["#0B1F3A", "#F6C542", "#D71920", "#FFFFFF"];
  const dark = palette[0] ?? "#0B1F3A";
  const accent = palette[1] ?? "#F6C542";
  const light = palette.find((c) => /fff|fefe|f\df/i.test(c)) ?? "#FFFFFF";

  const logoEl = (): ReelDocElement[] =>
    hasLogo ? [{ id: "logo", type: "image", role: "logo", x: SAFE_SIDE, y: SAFE_TOP * 0.6, w: 32, h: 6, src: "media/logo.png", fit: "contain", enter: { type: "fade", durationInFrames: 12 } }] : [];

  const scenes: ReelDoc["scenes"] = [];

  // Title card
  scenes.push({
    id: "title",
    durationInFrames: sec2frames(script.titleCard?.durationSec ?? 4),
    background: { type: "gradient", from: dark, to: shade(dark, 22), angle: 155 },
    elements: [
      ...logoEl(),
      { id: "title-h", type: "text", role: "headline", x: SAFE_SIDE, y: 34, w: 100 - 2 * SAFE_SIDE, h: 22, text: script.titleCard?.headline ?? script.direction, fontRole: "heading", fontSize: 96, fontWeight: 800, color: light, align: "left", lineHeight: 1.0, enter: { type: "fadeUp", durationInFrames: 16 } },
      { id: "title-accent", type: "shape", role: "shape", x: SAFE_SIDE, y: 58, w: 20, h: 1.1, shape: "line", color: accent, enter: { type: "slideR", durationInFrames: 16, delayInFrames: 10 } },
      ...(script.titleCard?.subtitle ? [{ id: "title-sub", type: "text" as const, role: "caption" as const, x: SAFE_SIDE, y: 62, w: 70, h: 8, text: script.titleCard.subtitle, fontRole: "accent" as const, fontSize: 48, fontWeight: 400, color: accent, align: "left" as const, enter: { type: "fade" as const, durationInFrames: 16, delayInFrames: 14 } }] : []),
    ],
  });

  // Media scenes
  for (const beat of script.scenes) {
    const fn = mediaFilename(beat, mediaManifest);
    const durationInFrames = sec2frames(beat.durationSec ?? 4);
    const els: ReelDocElement[] = [];
    if (fn) {
      const info = mediaManifest.get(fn)!;
      els.push({
        id: `m-${beat.index}`, type: info.type, role: info.type === "video" ? "video" : "photo",
        x: 0, y: 0, w: 100, h: 100, src: `media/${fn}`, fit: "cover",
        focusX: clamp(beat.focusX ?? 50, 0, 100), focusY: clamp(beat.focusY ?? 50, 0, 100),
        ...(info.type === "video" ? { trimStartSec: beat.trimStartSec, trimEndSec: beat.trimEndSec } : {}),
        ...(info.type === "image" && beat.kenBurns ? { kenBurns: kenBurnsFor(beat) } : {}),
      } as ReelDocElement);
    } else {
      els.push({ id: `bg-${beat.index}`, type: "shape", role: "background", x: 0, y: 0, w: 100, h: 100, shape: "rect", color: dark });
    }
    // Caption + scrim
    if (beat.textOverlay?.text) {
      const pos = beat.textOverlay.position;
      const y = pos === "top" ? SAFE_TOP : pos === "center" ? 44 : 100 - SAFE_BOTTOM - 12;
      const scrimY = pos === "top" ? 0 : pos === "center" ? 34 : 60;
      els.push({ id: `scrim-${beat.index}`, type: "shape", role: "shape", x: 0, y: scrimY, w: 100, h: 40, shape: "rect", color: "rgba(0,0,0,0.42)" });
      const fontRole = beat.textOverlay.style === "handwritten" ? "accent" : beat.textOverlay.style === "minimal" ? "body" : "heading";
      els.push({ id: `cap-${beat.index}`, type: "text", role: "caption", x: SAFE_SIDE, y, w: 100 - 2 * SAFE_SIDE, h: 12, text: beat.textOverlay.text, fontRole, fontSize: fontRole === "heading" ? 64 : 44, fontWeight: fontRole === "heading" ? 800 : 600, color: light, align: pos === "center" ? "center" : "left", lineHeight: 1.05, enter: { type: "fadeUp", durationInFrames: 14 } });
    }
    scenes.push({ id: `s-${beat.index}`, durationInFrames, transitionIn: scenes.length ? transitionFor(beat.transition) : undefined, elements: els });
  }

  // Closing card
  const closeText = [script.closingCard?.text, script.closingCard?.callToAction].filter(Boolean).join("\n");
  scenes.push({
    id: "closing",
    durationInFrames: sec2frames(script.closingCard?.durationSec ?? 4),
    transitionIn: { type: "fade", durationInFrames: 15 },
    background: { type: "gradient", from: shade(dark, 18), to: dark, angle: 200 },
    elements: [
      { id: "close-h", type: "text", role: "headline", x: SAFE_SIDE, y: 40, w: 100 - 2 * SAFE_SIDE, h: 18, text: closeText || "Thank you", fontRole: "heading", fontSize: 84, fontWeight: 800, color: light, align: "center", lineHeight: 1.05, enter: { type: "popIn", durationInFrames: 18 } },
      ...(hasFooter ? [{ id: "footer", type: "image" as const, role: "footer" as const, x: 0, y: 94, w: 100, h: 5.5, src: "media/footer.png", fit: "contain" as const, enter: { type: "fade" as const, durationInFrames: 14, delayInFrames: 8 } }] : logoEl()),
    ],
  });

  const doc: ReelDoc = {
    version: 1, fps: FPS, width: W, height: H,
    palette,
    fonts: { heading: script.typography?.heading, body: script.typography?.body, accent: script.typography?.accent },
    ...(input.hasMusic ? { music: { src: "music/track.mp3", gainDb: script.audioStyle === "voice-led" ? -12 : 0 } } : {}),
    scenes,
  };
  return applyAudioPolicy(doc, script.audioStyle);
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

/** Lighten a hex color by mixing toward white by `pct`%. Best-effort; returns input on parse failure. */
function shade(hex: string, pct: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * (pct / 100));
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, "0")}`;
}

/**
 * Generate a validated ReelDoc. Asks Codex to emit the JSON (creative layout); on
 * invalid JSON after a retry, falls back to the deterministic mapper. Media srcs are
 * validated against available files — any element pointing at a missing file is a
 * validation failure that triggers the retry / fallback.
 */
export async function generateReelDoc(input: ReelDocInput): Promise<{ doc: ReelDoc; source: "codex" | "deterministic" }> {
  const available = new Set<string>([
    ...[...input.mediaManifest.keys()].map((f) => `media/${f}`),
    ...(input.hasLogo ? ["media/logo.png"] : []),
    ...(input.hasFooter ? ["media/footer.png"] : []),
  ]);

  const mediaList = [...input.mediaManifest.entries()]
    .map(([fn, i]) => `- media/${fn} (${i.type}${i.orientation ? `, ${i.orientation}` : ""})`)
    .join("\n");
  const sceneList = input.script.scenes
    .map((b) => `  scene ${b.index}: media/${basename(b.mediaPath)} (${b.mediaType}, ${b.durationSec}s, focus ${b.focusX}/${b.focusY}${b.kenBurns ? `, kenBurns ${b.kenBurns.direction}/${b.kenBurns.intensity}` : ""}${b.textOverlay ? `, text "${b.textOverlay.text}" @${b.textOverlay.position}` : ""}, ${b.transition})`)
    .join("\n");

  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = buildDocPrompt(input, mediaList, sceneList, feedback);
      const raw = await codexText({ prompt, timeoutMs: input.timeoutMs });
      const parsed = JSON.parse(stripJsonFences(raw));
      const result = ReelDocSchema.safeParse(parsed);
      if (!result.success) {
        feedback = `\nYour previous JSON failed validation:\n${result.error.issues.slice(0, 12).map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}\nReturn corrected JSON.`;
        console.warn(`[ReelDoc] attempt ${attempt}: zod validation failed (${result.error.issues.length} issue(s))`);
        continue;
      }
      const missing = collectMediaSrcs(result.data).filter((s) => !available.has(s));
      if (missing.length) {
        feedback = `\nThese media srcs don't exist: ${[...new Set(missing)].join(", ")}. Only use the listed files.`;
        console.warn(`[ReelDoc] attempt ${attempt}: ${missing.length} invalid media ref(s)`);
        continue;
      }
      console.log(`[ReelDoc] Codex produced a valid ReelDoc (${result.data.scenes.length} scenes)`);
      return { doc: applyAudioPolicy(result.data, input.script.audioStyle), source: "codex" };
    } catch (err) {
      console.warn(`[ReelDoc] attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
      feedback = `\nYour previous reply was not valid JSON. Return ONLY a JSON object, no prose.`;
    }
  }

  console.log(`[ReelDoc] Falling back to deterministic scriptToReelDoc`);
  return { doc: scriptToReelDoc(input), source: "deterministic" };
}

/**
 * Apply a user's chat edit to an existing ReelDoc (the schema-reel counterpart of
 * editComposition). Codex returns the FULL updated doc; we zod-validate + check
 * media refs with a retry. No deterministic fallback — an arbitrary NL edit can't
 * be applied mechanically — so on failure it throws, and the caller (which only
 * swaps storage_paths after a verified re-render+upload) leaves the reel intact.
 */
export async function editReelDoc(input: {
  doc: ReelDoc;
  instruction: string;
  mediaManifest: Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>;
  hasLogo: boolean;
  hasFooter: boolean;
  hasMusic: boolean;
  /** User-attached reference/annotation images pointing at the exact scene/element to change. */
  referenceImages?: Buffer[];
  timeoutMs?: number;
}): Promise<ReelDoc> {
  const refImages = (input.referenceImages ?? []).map((buffer) => ({ buffer, detail: "high" as const }));
  const referenceNote = refImages.length
    ? `\n\nATTACHED: ${refImages.length} user REFERENCE image(s) — annotated screenshots/frames the user marked up to point at the EXACT scene or element the request is about. Use them to locate precisely what to change.`
    : "";
  const available = new Set<string>([
    ...[...input.mediaManifest.keys()].map((f) => `media/${f}`),
    ...(input.hasLogo ? ["media/logo.png"] : []),
    ...(input.hasFooter ? ["media/footer.png"] : []),
  ]);
  const mediaList = [...input.mediaManifest.entries()]
    .map(([fn, i]) => `- media/${fn} (${i.type}${i.orientation ? `, ${i.orientation}` : ""})`)
    .join("\n");

  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = `You are editing an existing Instagram Reel described as a structured JSON document (a "ReelDoc"). Apply ONLY the user's requested change and keep EVERYTHING else byte-for-byte identical — same scenes, same order, same durations, same element positions/text/colors — except what the request touches. Output ONLY the full updated JSON object (no prose, no code fence).

USER'S EDIT REQUEST:
"${input.instruction}"${referenceNote}

CURRENT ReelDoc:
${JSON.stringify(input.doc)}

FILES THAT EXIST (staticFile paths — reference ONLY these):
${mediaList || "(no photos/videos)"}
${input.hasLogo ? "- media/logo.png (logo)\n" : ""}${input.hasFooter ? "- media/footer.png (footer strip)\n" : ""}${input.hasMusic ? "- music/track.mp3 (music)\n" : ""}
RULES:
- Keep the SAME schema shape as the input. Positions are % of a 1080x1920 canvas; font sizes are px.
- Change the minimum needed. Do NOT restyle, reorder, or re-time unrelated scenes/elements.
- Only reference files listed above; staticFile("media/<file>") with no "public/" prefix.
- The logo element uses src "media/logo.png" and should keep objectFit "contain" (never stretch it). To put a backing/glow behind the logo, add a shape element BEHIND it (earlier in the scene's elements array), don't distort the logo.
- AUDIO: every video element supports "mute" (true = the clip's ORIGINAL voices/background noise are silenced) and the reel has "music": { "gainDb": n } (0 = full BGM, negative = quieter e.g. -6/-12, positive up to +6 = louder). To keep ONLY the background music / remove the original voices/noise, set "mute": true on EVERY video element (and leave gainDb at 0). To make the music louder, raise music.gainDb toward 0 or positive. To bring clip audio back, set "mute": false.${feedback}

Output the full updated JSON now:`;

      console.log(`[ReelDoc] Edit attempt ${attempt}/2 — asking Codex to mutate the doc (${input.doc.scenes.length} scenes, ${refImages.length} reference image(s))`);
      const raw = await codexText({ prompt, images: refImages, timeoutMs: input.timeoutMs });
      const parsed = JSON.parse(stripJsonFences(raw));
      const result = ReelDocSchema.safeParse(parsed);
      if (!result.success) {
        feedback = `\nYour previous JSON failed validation:\n${result.error.issues.slice(0, 12).map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}\nReturn corrected JSON.`;
        console.warn(`[ReelDoc] edit attempt ${attempt}: zod validation failed (${result.error.issues.length} issue(s))`);
        continue;
      }
      const missing = collectMediaSrcs(result.data).filter((s) => !available.has(s));
      if (missing.length) {
        feedback = `\nThese media srcs don't exist: ${[...new Set(missing)].join(", ")}. Only use the listed files.`;
        console.warn(`[ReelDoc] edit attempt ${attempt}: ${missing.length} invalid media ref(s)`);
        continue;
      }
      console.log(`[ReelDoc] Edit produced a valid ReelDoc (${result.data.scenes.length} scenes)`);
      return result.data;
    } catch (err) {
      console.warn(`[ReelDoc] edit attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`);
      feedback = `\nYour previous reply was not valid JSON. Return ONLY the JSON object.`;
    }
  }
  throw new Error("Could not produce a valid edited ReelDoc after 2 attempts (reel left unchanged)");
}

function buildDocPrompt(input: ReelDocInput, mediaList: string, sceneList: string, feedback: string): string {
  const s = input.script;
  return `You are laying out an Instagram Reel as a STRUCTURED JSON document (a "ReelDoc"). Output ONLY the JSON object — no prose, no code fence.

CANVAS: 1080x1920, 30fps. Positions x/y/w/h are PERCENT of the canvas (0-100). Font sizes are px (min ${MIN_FONT}). Keep text/logo inside the safe area: top≥${SAFE_TOP.toFixed(0)}%, sides≥${SAFE_SIDE.toFixed(0)}%, bottom≥${SAFE_BOTTOM.toFixed(0)}%.

CREATIVE DIRECTION: ${s.direction} — ${s.visualRegister}
PALETTE: ${(s.colorPalette ?? []).join(", ")}
FONTS: heading=${s.typography?.heading}, body=${s.typography?.body}, accent=${s.typography?.accent ?? "-"}

FILES YOU MAY REFERENCE (staticFile paths — use EXACTLY, no other files):
${mediaList || "(no photos/videos)"}
${input.hasLogo ? "- media/logo.png (logo)\n" : ""}${input.hasFooter ? "- media/footer.png (footer strip)\n" : ""}${input.hasMusic ? "- music/track.mp3 (background music)\n" : ""}
DIRECTOR'S SCENE PLAN (turn these into scenes; add a title card first and a closing card last):
${sceneList}
titleCard: "${s.titleCard?.headline ?? ""}" / "${s.titleCard?.subtitle ?? ""}" (${s.titleCard?.durationSec ?? 4}s)
closingCard: "${s.closingCard?.text ?? ""}" / CTA "${s.closingCard?.callToAction ?? ""}" (${s.closingCard?.durationSec ?? 4}s)

SCHEMA (TypeScript shape — emit matching JSON):
{ "version": 1, "fps": 30, "width": 1080, "height": 1920,
  "palette": string[], "fonts": { "heading": string, "body"?: string, "accent"?: string },
  ${input.hasMusic ? `"music": { "src": "music/track.mp3", "gainDb"?: number },` : ""}
  "scenes": [{
    "id": string, "durationInFrames": number,   // seconds x 30
    "background"?: { "type": "color", "color": string } | { "type": "gradient", "from": string, "to": string, "angle"?: number },
    "transitionIn"?: { "type": "fade"|"slideL"|"slideR"|"wipe"|"none", "durationInFrames": number },  // omit on first scene
    "elements": [ /* z-order = array order */
      { "type":"image"|"video", "role":"photo"|"video", "id":string, "x":n,"y":n,"w":n,"h":n, "src":string, "fit":"cover"|"contain", "focusX"?:n,"focusY"?:n, "radius"?:n, "trimStartSec"?:n,"trimEndSec"?:n, "kenBurns"?:{"from":n,"to":n,"panX"?:n,"panY"?:n}, "enter"?:Anim },
      { "type":"text", "role":"headline"|"caption"|"logo"|"footer", "id":string, "x":n,"y":n,"w":n,"h":n, "text":string, "fontRole":"heading"|"body"|"accent", "fontSize":n, "fontWeight"?:n, "color":string, "align":"left"|"center"|"right", "background"?:string, "padding"?:n, "radius"?:n, "enter"?:Anim },
      { "type":"shape", "role":"shape", "id":string, "x":n,"y":n,"w":n,"h":n, "shape":"rect"|"pill"|"line", "color":string, "radius"?:n, "enter"?:Anim }
    ]
  }]
}
Anim = { "type":"fade"|"fadeUp"|"popIn"|"slideL"|"slideR"|"none", "durationInFrames"?:n, "delayInFrames"?:n }

RULES:
- Background photo/video: full-bleed (x:0,y:0,w:100,h:100, fit:"cover"). Put a semi-transparent scrim shape (e.g. "rgba(0,0,0,0.42)") BEHIND text over photos so it stays legible.
- Use kenBurns on still photos for motion (subtle: from 1.0 to ~1.1).
- Logo: place it once (top-left, ~32% wide, fit "contain"); never stretch it.
- durationInFrames per scene = its seconds x 30. Match the director's durations.
- Reference ONLY the files listed above.${feedback}

Output the JSON now:`;
}
