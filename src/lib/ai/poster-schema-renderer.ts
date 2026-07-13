/**
 * poster-schema-renderer — the FIXED layout engine that turns a PosterDoc page
 * into an SVG string (+ the photo frames for the compositor). Phase 2 of the V3
 * quality fix.
 *
 * Why this beats the blind SVG author (Phase 1): the model emits a PosterDoc
 * (what content, what order, which palette) and NEVER coordinates. This engine
 * computes every pixel with a vertical FLOW layout, so overlaps and dead space
 * are structurally impossible, and it owns BOTH the chrome and the photo-frame
 * geometry, so they can't disagree.
 *
 * Fonts: text is OUTLINED to SVG <path> with opentype.js from the committed
 * assets/poster-fonts/ files — no system font / fontconfig, identical on every
 * machine (Strategy B).
 */
import fs from "fs";
import path from "path";
import opentype from "opentype.js";
import type { NormalizedPhotoFrame } from "./poster-compositor";
import type { PosterDoc, PosterPage, PosterBand, PosterPalette, PosterBackground } from "./poster-doc";

const FONT_DIR = path.join(process.cwd(), "assets/poster-fonts");
const CANVAS_W = 1024;
const CANVAS_H = 1536;

// ── Fonts ──────────────────────────────────────────────────────────────────
type LoadedFont = { font: opentype.Font };
type FontEntry = { family: string; file: string; weight: number; category: string };
const fontCache = new Map<string, LoadedFont>();
let manifestCache: { fonts: FontEntry[] } | null = null;

function manifest(): { fonts: FontEntry[] } {
  if (!manifestCache) {
    manifestCache = JSON.parse(fs.readFileSync(path.join(FONT_DIR, "manifest.json"), "utf8"));
  }
  return manifestCache!;
}

function fileForFamily(family: string): string {
  const m = manifest();
  const hit = m.fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (hit) return hit.file;
  // Fallback: first sans-body font, else first font.
  return (m.fonts.find((f) => f.category === "sans-body") ?? m.fonts[0]).file;
}

function getFont(family: string): opentype.Font {
  const file = fileForFamily(family);
  const cached = fontCache.get(file);
  if (cached) return cached.font;
  const buf = fs.readFileSync(path.join(FONT_DIR, file));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  fontCache.set(file, { font });
  return font;
}

/** List the curated font menu (family + category) — for the creative agent's prompt. */
export function fontMenu(): { family: string; category: string }[] {
  return manifest().fonts.map((f) => ({ family: f.family, category: f.category }));
}

// ── Text metrics + outlining ─────────────────────────────────────────────────
function advance(font: opentype.Font, text: string, size: number, tracking = 0): number {
  if (!tracking) return font.getAdvanceWidth(text, size);
  let w = 0;
  for (const ch of text) w += font.getAdvanceWidth(ch, size) + tracking;
  return Math.max(0, w - tracking);
}

/** Round to 2 decimals. opentype.js emits NaN in path data when a glyph pen
 *  position is an over-precise float (e.g. 300.88000000000005), and librsvg
 *  then aborts that <path> mid-render, truncating the text. font.getPath(string)
 *  accumulates that float noise INTERNALLY (so rounding the start can't help),
 *  which is why outline() lays glyphs out itself and rounds each pen position. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Outline a line to SVG path data, left edge at x and baseline at y. Lays out
 * glyph-by-glyph via charToGlyph (a simple cmap lookup) so we can round every
 * pen position — the only reliable way to stop opentype.js emitting NaN coords.
 * We deliberately avoid font.stringToGlyphs / getPath(string): those run the
 * GSUB shaping engine, which throws on advanced lookups present in some of the
 * curated fonts ("substFormat 2 is not yet supported"). Latin poster copy
 * doesn't need shaping/ligatures; pair kerning is applied manually.
 */
function outline(font: opentype.Font, text: string, size: number, x: number, baselineY: number, tracking = 0): string {
  const scale = size / font.unitsPerEm;
  const by = r2(baselineY);
  let penX = x;
  let prev: opentype.Glyph | null = null;
  const parts: string[] = [];
  for (const ch of Array.from(text)) {
    const g = font.charToGlyph(ch);
    if (prev && !tracking) {
      try { penX += font.getKerningValue(prev, g) * scale; } catch { /* no kern table */ }
    }
    const d = g.getPath(r2(penX), by, size).toPathData(2);
    if (d) parts.push(d);
    penX += (g.advanceWidth ?? 0) * scale + tracking;
    prev = g;
  }
  return parts.join(" ");
}

/** Shrink size so the text fits within maxWidth (never enlarges). */
function fitSize(font: opentype.Font, text: string, desired: number, maxWidth: number, tracking = 0): number {
  const w = advance(font, text, desired, tracking);
  return w <= maxWidth ? desired : Math.max(8, (desired * maxWidth) / w);
}

/** Greedy word-wrap to fit maxWidth at the given size. */
function wrap(font: opentype.Font, text: string, size: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [text];
  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${line} ${words[i]}`;
    if (advance(font, test, size) <= maxWidth) line = test;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}

function ascent(font: opentype.Font, size: number): number {
  return (font.ascender / font.unitsPerEm) * size;
}
function textLineHeight(font: opentype.Font, size: number): number {
  return ((font.ascender - font.descender) / font.unitsPerEm) * size;
}

function alignLeft(align: Align, x0: number, contentW: number, textW: number): number {
  if (align === "center") return x0 + (contentW - textW) / 2;
  if (align === "right") return x0 + contentW - textW;
  return x0;
}

// ── Colour ───────────────────────────────────────────────────────────────────
type Align = "left" | "center" | "right";
function color(value: string | undefined, palette: PosterPalette, fallback: string): string {
  if (!value) return fallback;
  const role = (palette as Record<string, string | undefined>)[value];
  return role ?? value;
}

// ── Fonts per role ─────────────────────────────────────────────────────────
function fontFor(doc: PosterDoc, role: "heading" | "body" | "accent" | undefined): opentype.Font {
  const r = role ?? "body";
  const family = doc.fonts[r] ?? doc.fonts.body;
  return getFont(family);
}

// ── Layout: measure each band's natural height ───────────────────────────────
const SCALE = {
  eyebrow: 30, eyebrowTracking: 6,
  heading: 112, headingLine: 1.04,
  subheading: 40, textBlock: 30, chip: 30,
  divider: 34, icon: 92, bodyLine: 1.28,
};

function bandFlex(b: PosterBand): number {
  if (b.type === "photoGrid") return b.flex ?? 1;
  if (b.type === "spacer") return b.flex ?? 1;
  return 0;
}

function measureBand(doc: PosterDoc, b: PosterBand, contentW: number): number {
  switch (b.type) {
    case "eyebrow": {
      const f = fontFor(doc, b.font ?? "accent");
      return textLineHeight(f, b.size ?? SCALE.eyebrow);
    }
    case "heading": {
      const f = fontFor(doc, b.font ?? "heading");
      const desired = b.size ?? SCALE.heading;
      const size = b.lines.reduce((s, ln) => Math.min(s, fitSize(f, ln.text, desired, contentW)), desired);
      return b.lines.length * size * (b.lineHeight ?? SCALE.headingLine);
    }
    case "subheading":
    case "textBlock": {
      const f = fontFor(doc, b.font ?? "body");
      const size = b.size ?? (b.type === "subheading" ? SCALE.subheading : SCALE.textBlock);
      const lines = wrap(f, b.text, size, contentW);
      return lines.length * size * SCALE.bodyLine;
    }
    case "chip": {
      const size = b.size ?? SCALE.chip;
      return size * 2.0;
    }
    case "divider":
      return SCALE.divider;
    case "iconRow":
      return b.size ?? SCALE.icon;
    case "photoGrid":
    case "spacer":
      return b.type === "spacer" ? (b.minHeight ?? 0) : 0; // flex-driven
  }
}

type Placed = { band: PosterBand; y: number; height: number };

function layout(doc: PosterDoc, page: PosterPage): {
  placed: Placed[];
  contentX: number;
  contentW: number;
} {
  const margin = page.margin ?? 64;
  const gap = page.gap ?? 28;
  const topReserve = page.reserveLogo ? Math.round(CANVAS_H * 0.12) : 0;
  const botReserve = page.reserveFooter ? Math.round(CANVAS_H * 0.075) : 0;
  const contentX = margin;
  const contentW = CANVAS_W - margin * 2;
  const contentTop = margin + topReserve;
  const contentBottom = CANVAS_H - margin - botReserve;
  const contentH = contentBottom - contentTop;

  const measured = page.bands.map((band) => ({
    band,
    flex: bandFlex(band),
    height: measureBand(doc, band, contentW),
  }));

  const totalGap = gap * Math.max(0, page.bands.length - 1);
  const fixedH = measured.reduce((s, m) => s + (m.flex === 0 ? m.height : 0), 0);
  const minFlexH = measured.reduce((s, m) => s + (m.flex > 0 ? m.height : 0), 0);
  const flexTotal = measured.reduce((s, m) => s + m.flex, 0);
  const leftover = Math.max(0, contentH - fixedH - minFlexH - totalGap);

  for (const m of measured) {
    if (m.flex > 0) m.height += flexTotal > 0 ? (leftover * m.flex) / flexTotal : 0;
  }

  // Centre the stack vertically when nothing flexes and there's slack.
  const usedH = measured.reduce((s, m) => s + m.height, 0) + totalGap;
  let y = contentTop + (flexTotal === 0 && usedH < contentH ? (contentH - usedH) / 2 : 0);

  const placed: Placed[] = [];
  for (const m of measured) {
    placed.push({ band: m.band, y, height: m.height });
    y += m.height + gap;
  }
  return { placed, contentX, contentW };
}

// ── Photo frame geometry ─────────────────────────────────────────────────────
type PxRect = { x: number; y: number; w: number; h: number };
function gridCells(rect: PxRect, cols: number, rows: number, gap: number): PxRect[] {
  const cw = (rect.w - gap * (cols - 1)) / cols;
  const ch = (rect.h - gap * (rows - 1)) / rows;
  const cells: PxRect[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ x: rect.x + c * (cw + gap), y: rect.y + r * (ch + gap), w: cw, h: ch });
  return cells;
}

function photoRects(rect: PxRect, n: number, layoutName: string | undefined, gap: number): PxRect[] {
  const kind = layoutName ?? (n === 1 ? "single" : n === 2 ? "duo" : n === 3 ? "trio" : n === 4 ? "quad" : "grid6");
  switch (kind) {
    case "single": return [rect];
    case "duo": return gridCells(rect, 2, 1, gap);
    case "trio": {
      const leftW = rect.w * 0.6 - gap / 2;
      const rightX = rect.x + leftW + gap;
      const rightW = rect.w - leftW - gap;
      const rh = (rect.h - gap) / 2;
      return [
        { x: rect.x, y: rect.y, w: leftW, h: rect.h },
        { x: rightX, y: rect.y, w: rightW, h: rh },
        { x: rightX, y: rect.y + rh + gap, w: rightW, h: rh },
      ];
    }
    case "quad": return gridCells(rect, 2, 2, gap);
    case "hero-strip": {
      const heroH = rect.h * 0.6 - gap / 2;
      const stripCells = Math.max(1, n - 1);
      const strip = gridCells({ x: rect.x, y: rect.y + heroH + gap, w: rect.w, h: rect.h - heroH - gap }, stripCells, 1, gap);
      return [{ x: rect.x, y: rect.y, w: rect.w, h: heroH }, ...strip];
    }
    case "grid6":
    default: {
      const rows = Math.ceil(n / 2);
      return gridCells(rect, 2, rows, gap).slice(0, n);
    }
  }
}

// ── Icons (simple built-in line set) ─────────────────────────────────────────
// Paths authored in a 0..100 box; scaled/translated per placement.
const ICONS: Record<string, string> = {
  heart: "M50 82 C20 58 22 30 42 30 C50 30 50 40 50 40 C50 40 50 30 58 30 C78 30 80 58 50 82 Z",
  star: "M50 20 L59 42 L83 44 L64 60 L70 84 L50 71 L30 84 L36 60 L17 44 L41 42 Z",
  people: "M35 40 A9 9 0 1 1 35 39.9 M65 40 A9 9 0 1 1 65 39.9 M20 78 C20 60 32 55 35 55 C38 55 50 60 50 78 M50 78 C50 60 62 55 65 55 C68 55 80 60 80 78",
  book: "M50 32 C40 26 24 26 20 30 L20 74 C24 70 40 70 50 76 C60 70 76 70 80 74 L80 30 C76 26 60 26 50 32 Z M50 32 L50 76",
  trophy: "M32 26 L68 26 L66 48 C66 60 58 64 50 64 C42 64 34 60 34 48 Z M32 30 L22 30 C22 44 30 46 34 46 M68 30 L78 30 C78 44 70 46 66 46 M44 64 L44 76 L56 76 L56 64 M36 80 L64 80",
  bulb: "M50 24 C36 24 28 34 28 46 C28 56 36 60 38 68 L62 68 C64 60 72 56 72 46 C72 34 64 24 50 24 Z M40 74 L60 74 M43 80 L57 80",
  flag: "M32 22 L32 82 M32 26 C46 20 58 34 74 28 L74 52 C58 58 46 44 32 50",
  medal: "M38 22 L50 46 L62 22 M50 46 A20 20 0 1 1 49.9 46 M50 56 L54 64 L62 65 L56 71 L58 79 L50 75 L42 79 L44 71 L38 65 L46 64 Z",
};

function renderIconRow(b: Extract<PosterBand, { type: "iconRow" }>, y: number, contentX: number, contentW: number, palette: PosterPalette): string {
  const size = b.size ?? SCALE.icon;
  const stroke = color(b.color, palette, palette.accent);
  const n = b.icons.length;
  const totalW = n * size + (n - 1) * (size * 0.6);
  let x = alignLeft("center", contentX, contentW, totalW);
  const frags: string[] = [];
  for (const name of b.icons) {
    const p = ICONS[name] ?? ICONS.star;
    const s = size / 100;
    frags.push(
      `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(4)})">` +
      `<circle cx="50" cy="50" r="46" fill="none" stroke="${stroke}" stroke-width="3"/>` +
      `<path d="${p}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>` +
      `</g>`,
    );
    x += size + size * 0.6;
  }
  return frags.join("");
}

// ── Background ───────────────────────────────────────────────────────────────
function renderBackground(bg: PosterBackground, palette: PosterPalette): string {
  if (bg.type === "color") return `<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${color(bg.color, palette, palette.bg)}"/>`;
  if (bg.type === "gradient") {
    const a = ((bg.angle ?? 160) * Math.PI) / 180;
    const x2 = (50 + 50 * Math.cos(a)).toFixed(2), y2 = (50 + 50 * Math.sin(a)).toFixed(2);
    const x1 = (50 - 50 * Math.cos(a)).toFixed(2), y1 = (50 - 50 * Math.sin(a)).toFixed(2);
    return `<defs><linearGradient id="bg" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">` +
      `<stop offset="0%" stop-color="${color(bg.from, palette, palette.bg)}"/>` +
      `<stop offset="100%" stop-color="${color(bg.to, palette, palette.accent)}"/>` +
      `</linearGradient></defs><rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#bg)"/>`;
  }
  // split
  const c1 = color(bg.color1, palette, palette.bg), c2 = color(bg.color2, palette, palette.accent);
  const ratio = bg.ratio ?? 0.5;
  if (bg.direction === "horizontal") {
    const yb = Math.round(CANVAS_H * ratio);
    return `<rect width="${CANVAS_W}" height="${yb}" fill="${c1}"/><rect y="${yb}" width="${CANVAS_W}" height="${CANVAS_H - yb}" fill="${c2}"/>`;
  }
  if (bg.direction === "vertical") {
    const xb = Math.round(CANVAS_W * ratio);
    return `<rect width="${xb}" height="${CANVAS_H}" fill="${c1}"/><rect x="${xb}" width="${CANVAS_W - xb}" height="${CANVAS_H}" fill="${c2}"/>`;
  }
  // diagonal
  const xb = Math.round(CANVAS_W * ratio);
  return `<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="${c2}"/>` +
    `<polygon points="0,0 ${xb + 200},0 ${xb - 200},${CANVAS_H} 0,${CANVAS_H}" fill="${c1}"/>`;
}

// ── Decoration / ornament layer ──────────────────────────────────────────────
// Drawn behind content, keyed to the palette, kept in margins/corners so it
// reads as texture and never fights text or photos. Fully deterministic.

/** Concentric quarter-arcs sweeping through the corners (EKAM-style). */
function ornArcs(palette: PosterPalette): string {
  const c = color("accent2", palette, palette.accent);
  const arc = (cx: number, cy: number, r: number, op: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="2" opacity="${op}"/>`;
  const corners: [number, number][] = [[-70, -70], [CANVAS_W + 70, -70], [-70, CANVAS_H + 70], [CANVAS_W + 70, CANVAS_H + 70]];
  return corners.map(([cx, cy], i) =>
    [250, 320, 390].map((r, j) => arc(cx, cy, r, i < 2 ? 0.22 - j * 0.04 : 0.12 - j * 0.03)).join(""),
  ).join("");
}

/** Small dots scattered down the side margins + corners. Deterministic pattern. */
function ornDots(palette: PosterPalette): string {
  const c = color("accent2", palette, palette.accent);
  // Fixed positions in the outer margins (x normalized), avoiding the content column.
  const pts: [number, number, number][] = [
    [30, 300, 5], [46, 420, 3], [26, 560, 6], [40, 720, 4], [30, 980, 5], [48, 1180, 3],
    [994, 300, 5], [978, 440, 3], [998, 600, 6], [982, 780, 4], [994, 1040, 5], [976, 1200, 3],
    [120, 210, 4], [900, 210, 4], [150, 1340, 4], [880, 1340, 4],
  ];
  return pts.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.7"/>`).join("");
}

/** Thin L-brackets framing the four corners. */
function ornCorners(palette: PosterPalette): string {
  const c = color("accent2", palette, palette.accent);
  const inset = 30, arm = 58, w = 3;
  const L = (x: number, y: number, dx: number, dy: number) =>
    `<path d="M${x + dx * arm} ${y} L${x} ${y} L${x} ${y + dy * arm}" fill="none" stroke="${c}" stroke-width="${w}" opacity="0.5" stroke-linecap="round"/>`;
  return [
    L(inset, inset, 1, 1),
    L(CANVAS_W - inset, inset, -1, 1),
    L(inset, CANVAS_H - inset, 1, -1),
    L(CANVAS_W - inset, CANVAS_H - inset, -1, -1),
  ].join("");
}

/** A few short accent bars, lower-left (HillRock-style flourish). */
function ornBars(palette: PosterPalette): string {
  const a = color("accent", palette, palette.accent);
  const a2 = color("accent2", palette, palette.accent);
  const y = CANVAS_H - 190;
  return `<rect x="64" y="${y}" width="120" height="8" rx="4" fill="${a2}"/>` +
    `<rect x="196" y="${y}" width="46" height="8" rx="4" fill="${a}"/>`;
}

function renderDecor(styles: string[] | undefined, palette: PosterPalette): string {
  if (!styles || !styles.length) return "";
  const map: Record<string, (p: PosterPalette) => string> = { arcs: ornArcs, dots: ornDots, corners: ornCorners, bars: ornBars };
  return styles.map((s) => map[s]?.(palette) ?? "").join("");
}

/** Soft drop-shadow filter (once per SVG) for photo depth. */
function shadowDefs(): string {
  return `<defs><filter id="pshadow" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.22"/></filter></defs>`;
}

// ── Band rendering ───────────────────────────────────────────────────────────
function renderBand(
  doc: PosterDoc, b: PosterBand, p: Placed, contentX: number, contentW: number,
): { svg: string; frames: NormalizedPhotoFrame[] } {
  const palette = doc.palette;
  const frames: NormalizedPhotoFrame[] = [];
  let svg = "";

  switch (b.type) {
    case "eyebrow": {
      const f = fontFor(doc, b.font ?? "accent");
      const size = b.size ?? SCALE.eyebrow;
      const tracking = b.letterSpacing ?? SCALE.eyebrowTracking;
      const text = b.text;
      const w = advance(f, text, size, tracking);
      const x = alignLeft(b.align ?? "center", contentX, contentW, w);
      const baseline = p.y + ascent(f, size);
      svg = `<path d="${outline(f, text, size, x, baseline, tracking)}" fill="${color(b.color, palette, palette.accent)}"/>`;
      break;
    }
    case "heading": {
      const f = fontFor(doc, b.font ?? "heading");
      const desired = b.size ?? SCALE.heading;
      const size = b.lines.reduce((s, ln) => Math.min(s, fitSize(f, ln.text, desired, contentW)), desired);
      const lh = size * (b.lineHeight ?? SCALE.headingLine);
      const parts: string[] = [];
      b.lines.forEach((ln, i) => {
        const w = advance(f, ln.text, size);
        const x = alignLeft(b.align ?? "center", contentX, contentW, w);
        const baseline = p.y + ascent(f, size) + i * lh;
        parts.push(`<path d="${outline(f, ln.text, size, x, baseline)}" fill="${color(ln.color, palette, palette.ink)}"/>`);
      });
      svg = parts.join("");
      break;
    }
    case "subheading":
    case "textBlock": {
      const f = fontFor(doc, b.font ?? "body");
      const size = b.size ?? (b.type === "subheading" ? SCALE.subheading : SCALE.textBlock);
      const lines = wrap(f, b.text, size, contentW);
      const lh = size * SCALE.bodyLine;
      const parts: string[] = [];
      lines.forEach((ln, i) => {
        const w = advance(f, ln, size);
        const x = alignLeft(b.align ?? "center", contentX, contentW, w);
        const baseline = p.y + ascent(f, size) + i * lh;
        parts.push(`<path d="${outline(f, ln, size, x, baseline)}" fill="${color(b.color, palette, b.type === "subheading" ? palette.ink : palette.muted ?? palette.ink)}"/>`);
      });
      svg = parts.join("");
      break;
    }
    case "chip": {
      const f = fontFor(doc, "accent");
      const size = b.size ?? SCALE.chip;
      const padX = size * 0.7, padY = size * 0.4;
      const w = advance(f, b.text, size);
      const chipW = w + padX * 2, chipH = size + padY * 2;
      const x = alignLeft(b.align ?? "center", contentX, contentW, chipW);
      const bg = color(b.background, palette, palette.accent);
      const fg = color(b.color, palette, palette.bg);
      const baseline = p.y + padY + ascent(f, size);
      svg = `<rect x="${x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${bg}"/>` +
        `<path d="${outline(f, b.text, size, x + padX, baseline)}" fill="${fg}"/>`;
      break;
    }
    case "divider": {
      const c = color(b.color, palette, palette.accent);
      const w = contentW * (b.widthPct ?? 0.28);
      const cx = contentX + contentW / 2;
      const y = p.y + p.height / 2;
      const half = w / 2;
      if ((b.style ?? "line-diamond") === "line") {
        svg = `<line x1="${cx - half}" y1="${y}" x2="${cx + half}" y2="${y}" stroke="${c}" stroke-width="3"/>`;
      } else {
        const d = 9;
        svg = `<line x1="${cx - half}" y1="${y}" x2="${cx - d - 6}" y2="${y}" stroke="${c}" stroke-width="3"/>` +
          `<line x1="${cx + d + 6}" y1="${y}" x2="${cx + half}" y2="${y}" stroke="${c}" stroke-width="3"/>` +
          `<rect x="${cx - d / 1.4}" y="${y - d / 1.4}" width="${d * 1.4}" height="${d * 1.4}" transform="rotate(45 ${cx} ${y})" fill="${c}"/>`;
      }
      break;
    }
    case "iconRow": {
      svg = renderIconRow(b, p.y, contentX, contentW, palette);
      break;
    }
    case "photoGrid": {
      const gap = b.gap ?? 18;
      const rect: PxRect = { x: contentX, y: p.y, w: contentW, h: p.height };
      const rects = photoRects(rect, b.photos.length, b.layout, gap);
      const radius = b.radius ?? 24;
      const shadow = b.shadow ?? true;
      const card = (b.frameStyle ?? "plain") === "card";
      const cardPad = card ? 14 : 0;
      const parts: string[] = [];
      b.photos.forEach((photoPath, i) => {
        const r = rects[i];
        if (!r) return;
        const rr = (n: number) => n.toFixed(1);
        // Soft shadow behind the (composited) photo, for depth.
        if (shadow) {
          parts.push(`<rect x="${rr(r.x - cardPad)}" y="${rr(r.y - cardPad)}" width="${rr(r.w + cardPad * 2)}" height="${rr(r.h + cardPad * 2)}" rx="${radius}" fill="#ffffff" filter="url(#pshadow)"/>`);
        }
        // Card matte: a white mat + thin accent hairline (framed-photo look).
        if (card) {
          parts.push(`<rect x="${rr(r.x - cardPad)}" y="${rr(r.y - cardPad)}" width="${rr(r.w + cardPad * 2)}" height="${rr(r.h + cardPad * 2)}" rx="${radius}" fill="#ffffff" stroke="${color("accent2", palette, palette.accent)}" stroke-width="2"/>`);
        }
        // Faint placeholder (photo is composited on top afterward).
        parts.push(`<rect x="${rr(r.x)}" y="${rr(r.y)}" width="${rr(r.w)}" height="${rr(r.h)}" rx="${radius}" fill="${color("muted", palette, "#e8e2d0")}" opacity="0.35"/>`);
        frames.push({
          path: photoPath,
          x: r.x / CANVAS_W, y: r.y / CANVAS_H, width: r.w / CANVAS_W, height: r.h / CANVAS_H,
          fit: "cover", radius,
          borderWidth: b.borderWidth ?? (card ? 0 : 6),
          borderColor: color(b.borderColor, palette, "#ffffff"),
        });
      });
      svg = parts.join("");
      break;
    }
    case "spacer":
      svg = "";
      break;
  }
  return { svg, frames };
}

/**
 * Render one PosterDoc page to an SVG string + the photo frames the compositor
 * should paste real photos into (coordinated with the drawn chrome).
 */
export function renderPosterDoc(doc: PosterDoc, pageIndex: number): { svg: string; photoFrames: NormalizedPhotoFrame[] } {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`PosterDoc has no page ${pageIndex}`);
  const { placed, contentX, contentW } = layout(doc, page);

  // Layer order: shadow filter defs -> background -> ornaments -> content.
  const layers: string[] = [shadowDefs(), renderBackground(page.background, doc.palette), renderDecor(page.decor, doc.palette)];
  const photoFrames: NormalizedPhotoFrame[] = [];
  for (const p of placed) {
    const { svg, frames } = renderBand(doc, p.band, p, contentX, contentW);
    if (svg) layers.push(svg);
    photoFrames.push(...frames);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">${layers.join("")}</svg>`;
  return { svg, photoFrames };
}
