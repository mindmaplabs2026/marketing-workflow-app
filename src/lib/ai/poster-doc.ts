/**
 * PosterDoc — the structured, data-driven document for a poster/carousel page
 * (Phase 2 of the V3 quality fix). The AI emits a PosterDoc as JSON; a FIXED
 * layout engine (poster-schema-renderer.ts) turns it into an SVG, so the model
 * never invents coordinates and overlaps/dead-space become impossible.
 *
 * Layout is a VERTICAL FLOW of bands (like a CSS column): the renderer stacks
 * them top-to-bottom inside a safe area, measuring each band's height and
 * distributing leftover space to flex bands. Photo frames are part of the flow,
 * so chrome and photos are coordinated by construction.
 *
 * Colours may be a hex string ("#0b1f3a") OR a palette role ("bg" | "ink" |
 * "accent" | "accent2" | "muted"); the renderer resolves roles against palette.
 */
import { z } from "zod";

/** A colour: hex (#rgb/#rrggbb) or a palette role name resolved by the renderer. */
const ColorSchema = z.string();

const AlignSchema = z.enum(["left", "center", "right"]);

const PaletteSchema = z.object({
  bg: ColorSchema,
  ink: ColorSchema,
  accent: ColorSchema,
  accent2: ColorSchema.optional(),
  muted: ColorSchema.optional(),
});

/** Font family names — MUST be families present in assets/poster-fonts/manifest.json. */
const FontsSchema = z.object({
  heading: z.string(),
  body: z.string(),
  accent: z.string().optional(),
});

const BackgroundSchema = z.union([
  z.object({ type: z.literal("color"), color: ColorSchema }),
  z.object({ type: z.literal("gradient"), from: ColorSchema, to: ColorSchema, angle: z.number().optional() }),
  z.object({
    type: z.literal("split"),
    color1: ColorSchema,
    color2: ColorSchema,
    direction: z.enum(["diagonal", "horizontal", "vertical"]).optional(),
    ratio: z.number().min(0.1).max(0.9).optional(),
  }),
]);

// ── Bands ────────────────────────────────────────────────────────────────────
// Every band flows vertically. `flex` (on spacer/photoGrid) claims a share of the
// leftover vertical space; fixed bands take only their measured height.

const EyebrowBand = z.object({
  type: z.literal("eyebrow"),
  text: z.string(),
  color: ColorSchema.optional(),
  align: AlignSchema.optional(),
  size: z.number().optional(),
  letterSpacing: z.number().optional(),
  font: z.enum(["heading", "body", "accent"]).optional(),
});

const HeadingBand = z.object({
  type: z.literal("heading"),
  /** Each entry is one line; per-line colour enables two-tone titles. */
  lines: z.array(z.object({ text: z.string(), color: ColorSchema.optional() })).min(1),
  align: AlignSchema.optional(),
  size: z.number().optional(),
  lineHeight: z.number().optional(),
  font: z.enum(["heading", "body", "accent"]).optional(),
});

const SubheadingBand = z.object({
  type: z.literal("subheading"),
  text: z.string(),
  color: ColorSchema.optional(),
  align: AlignSchema.optional(),
  size: z.number().optional(),
  font: z.enum(["heading", "body", "accent"]).optional(),
});

const TextBlockBand = z.object({
  type: z.literal("textBlock"),
  text: z.string(),
  color: ColorSchema.optional(),
  align: AlignSchema.optional(),
  size: z.number().optional(),
  font: z.enum(["heading", "body", "accent"]).optional(),
});

const ChipBand = z.object({
  type: z.literal("chip"),
  text: z.string(),
  color: ColorSchema.optional(),
  background: ColorSchema.optional(),
  align: AlignSchema.optional(),
  size: z.number().optional(),
});

const DividerBand = z.object({
  type: z.literal("divider"),
  style: z.enum(["line", "line-diamond"]).optional(),
  color: ColorSchema.optional(),
  widthPct: z.number().min(0.05).max(1).optional(),
});

const PhotoGridBand = z.object({
  type: z.literal("photoGrid"),
  /** Storage paths/ids of the photos to place, in order. */
  photos: z.array(z.string()).min(1),
  layout: z.enum([
    "single", "duo", "duoV", "trio", "trioRow", "quad", "quadFeature",
    "featured", "mosaic6", "grid6", "hero-strip",
  ]).optional(),
  gap: z.number().optional(),
  radius: z.number().optional(),
  borderWidth: z.number().optional(),
  borderColor: ColorSchema.optional(),
  /** Soft drop-shadow behind each photo for depth (default true). */
  shadow: z.boolean().optional(),
  /** "plain" = bordered photo; "card" = white matte + thin accent hairline (framed look). */
  frameStyle: z.enum(["plain", "card"]).optional(),
  /** Share of leftover vertical space (default 1 — photo grids grow to fill). */
  flex: z.number().optional(),
});

const IconRowBand = z.object({
  type: z.literal("iconRow"),
  /** Named icons drawn by the renderer's built-in line-icon set. */
  icons: z.array(z.enum(["heart", "star", "people", "book", "trophy", "bulb", "flag", "medal"])).min(1),
  color: ColorSchema.optional(),
  size: z.number().optional(),
});

const SpacerBand = z.object({
  type: z.literal("spacer"),
  flex: z.number().optional(),
  minHeight: z.number().optional(),
});

const BandSchema = z.discriminatedUnion("type", [
  EyebrowBand, HeadingBand, SubheadingBand, TextBlockBand,
  ChipBand, DividerBand, PhotoGridBand, IconRowBand, SpacerBand,
]);

const PageSchema = z.object({
  id: z.string(),
  background: BackgroundSchema,
  /** Outer margin in px (default 64). */
  margin: z.number().optional(),
  /** Gap between bands in px (default 28). */
  gap: z.number().optional(),
  /** Hold the top-left logo zone / bottom footer zone clear (brand composited later). */
  reserveLogo: z.boolean().optional(),
  reserveFooter: z.boolean().optional(),
  /** Deterministic ornament layer drawn behind content, keyed to the palette.
   *  Compose freely, e.g. ["arcs","dots"]. Kept in margins/corners so it reads
   *  as texture and never fights text or photos. */
  decor: z.array(z.enum(["arcs", "dots", "corners", "bars"])).optional(),
  bands: z.array(BandSchema).min(1),
});

export const PosterDocSchema = z.object({
  version: z.literal(1),
  canvas: z.object({ width: z.number(), height: z.number() }).optional(),
  palette: PaletteSchema,
  fonts: FontsSchema,
  pages: z.array(PageSchema).min(1),
});

export type PosterDoc = z.infer<typeof PosterDocSchema>;
export type PosterPage = z.infer<typeof PageSchema>;
export type PosterBand = z.infer<typeof BandSchema>;
export type PosterPalette = z.infer<typeof PaletteSchema>;
export type PosterBackground = z.infer<typeof BackgroundSchema>;
