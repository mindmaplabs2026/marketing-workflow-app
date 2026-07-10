/**
 * ReelDoc — the app-side zod schema + type for the structured reel scene graph
 * (Tier 2). The AI emits a ReelDoc as JSON; this validates it before we hand it to
 * the fixed renderer (remotion-renderer/schema/SchemaReel.tsx, which keeps its own
 * copy of these types). Keep the two in sync.
 *
 * Positions are PERCENTAGES of the canvas (0–100); font sizes are px on 1080-wide.
 */
import { z } from "zod";

const AnimSchema = z.object({
  type: z.enum(["fade", "fadeUp", "popIn", "slideL", "slideR", "none"]),
  durationInFrames: z.number().optional(),
  delayInFrames: z.number().optional(),
});

const baseFields = {
  id: z.string(),
  role: z.enum(["headline", "caption", "logo", "photo", "video", "shape", "chip", "background", "footer"]),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  rotation: z.number().optional(),
  opacity: z.number().optional(),
  enter: AnimSchema.optional(),
  exit: AnimSchema.optional(),
};

const TextSchema = z.object({
  ...baseFields,
  type: z.literal("text"),
  text: z.string(),
  fontRole: z.enum(["heading", "body", "accent"]).optional(),
  fontSize: z.number(),
  fontWeight: z.number().optional(),
  color: z.string(),
  align: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  background: z.string().optional(),
  padding: z.number().optional(),
  radius: z.number().optional(),
});

const mediaFields = {
  ...baseFields,
  src: z.string(),
  fit: z.enum(["cover", "contain"]).optional(),
  focusX: z.number().optional(),
  focusY: z.number().optional(),
  radius: z.number().optional(),
  trimStartSec: z.number().optional(),
  trimEndSec: z.number().optional(),
  // Video only: mute silences the clip's own audio (original voices/noise) so only
  // the reel BGM is heard; volume (0..1) sets clip level when not muted.
  mute: z.boolean().optional(),
  volume: z.number().optional(),
  kenBurns: z.object({
    from: z.number(), to: z.number(),
    panX: z.number().optional(), panY: z.number().optional(),
  }).optional(),
};

const ImageSchema = z.object({ ...mediaFields, type: z.literal("image") });
const VideoSchema = z.object({ ...mediaFields, type: z.literal("video") });

const ShapeSchema = z.object({
  ...baseFields,
  type: z.literal("shape"),
  shape: z.enum(["rect", "pill", "line"]),
  color: z.string(),
  radius: z.number().optional(),
});

const ElementSchema = z.discriminatedUnion("type", [TextSchema, ImageSchema, VideoSchema, ShapeSchema]);

const SceneSchema = z.object({
  id: z.string(),
  durationInFrames: z.number().positive(),
  background: z.union([
    z.object({ type: z.literal("color"), color: z.string() }),
    z.object({ type: z.literal("gradient"), from: z.string(), to: z.string(), angle: z.number().optional() }),
  ]).optional(),
  transitionIn: z.object({
    type: z.enum(["fade", "slideL", "slideR", "wipe", "none"]),
    durationInFrames: z.number().nonnegative(),
  }).optional(),
  elements: z.array(ElementSchema),
});

export const ReelDocSchema = z.object({
  version: z.literal(1),
  fps: z.number(),
  width: z.number(),
  height: z.number(),
  palette: z.array(z.string()).optional(),
  fonts: z.object({
    heading: z.string().optional(),
    body: z.string().optional(),
    accent: z.string().optional(),
  }).optional(),
  music: z.object({ src: z.string(), gainDb: z.number().optional() }).optional(),
  scenes: z.array(SceneSchema).min(1),
});

export type ReelDoc = z.infer<typeof ReelDocSchema>;
export type ReelDocElement = z.infer<typeof ElementSchema>;

/**
 * Total frames. TransitionSeries OVERLAPS each transition with the scenes it joins,
 * so timeline = sum(scene durations) − sum(transition durations). Mirrors the
 * renderer's computeDurationInFrames — the two MUST agree or the last scene clips.
 */
export function computeDurationInFrames(doc: ReelDoc): number {
  const seqSum = doc.scenes.reduce((s, sc) => s + sc.durationInFrames, 0);
  const transSum = doc.scenes.reduce(
    (s, sc, i) => (i > 0 && sc.transitionIn && sc.transitionIn.type !== "none" ? s + sc.transitionIn.durationInFrames : s),
    0,
  );
  return Math.max(1, seqSum - transSum);
}

/** Collect every media `src` referenced by the doc (for validating files exist). */
export function collectMediaSrcs(doc: ReelDoc): string[] {
  const srcs: string[] = [];
  for (const scene of doc.scenes) {
    for (const el of scene.elements) {
      if (el.type === "image" || el.type === "video") srcs.push(el.src);
    }
  }
  return srcs;
}
