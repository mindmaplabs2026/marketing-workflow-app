import sharp from "sharp";

type AnyBuffer = Buffer<ArrayBufferLike>;

export type NormalizedPhotoFrame = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fit?: "cover" | "contain";
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
};

type PhotoInput = {
  path: string;
  buffer: AnyBuffer;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function pxFrame(frame: NormalizedPhotoFrame, width: number, height: number) {
  const x = Math.round(clamp01(frame.x) * width);
  const y = Math.round(clamp01(frame.y) * height);
  const w = Math.max(1, Math.round(clamp01(frame.width) * width));
  const h = Math.max(1, Math.round(clamp01(frame.height) * height));
  return {
    left: Math.min(x, width - 1),
    top: Math.min(y, height - 1),
    width: Math.min(w, width - x),
    height: Math.min(h, height - y),
  };
}

async function roundedMask(width: number, height: number, radius: number): Promise<AnyBuffer> {
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  return sharp(
    Buffer.from(
      `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
    ),
  )
    .png()
    .toBuffer();
}

async function renderPhotoFrame(
  photo: PhotoInput,
  frame: NormalizedPhotoFrame,
  width: number,
  height: number,
): Promise<AnyBuffer> {
  const borderWidth = Math.max(0, Math.round(frame.borderWidth ?? 8));
  const borderColor = frame.borderColor ?? "#ffffff";
  const radius = Math.max(0, Math.round(frame.radius ?? 24));
  const innerWidth = Math.max(1, width - borderWidth * 2);
  const innerHeight = Math.max(1, height - borderWidth * 2);

  let photoLayer = await sharp(photo.buffer)
    .rotate()
    .resize(innerWidth, innerHeight, {
      fit: frame.fit ?? "cover",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  if (radius > 0) {
    const mask = await roundedMask(innerWidth, innerHeight, Math.max(0, radius - borderWidth));
    photoLayer = await sharp(photoLayer).removeAlpha().joinChannel(mask).png().toBuffer();
  }

  const frameLayer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: borderColor,
    },
  })
    .composite([{ input: photoLayer, left: borderWidth, top: borderWidth }])
    .png()
    .toBuffer();

  if (radius <= 0) return frameLayer;
  const mask = await roundedMask(width, height, radius);
  return sharp(frameLayer).removeAlpha().joinChannel(mask).png().toBuffer();
}

export function defaultPhotoFrames(
  paths: string[],
  pageIndex: number,
  totalPages: number,
): NormalizedPhotoFrame[] {
  const unique = [...new Set(paths)].slice(0, 6);
  const count = unique.length;
  if (count === 0) return [];

  const isCover = totalPages > 1 && pageIndex === 0;
  const isClosing = totalPages > 1 && pageIndex === totalPages - 1;
  const top = isCover ? 0.48 : isClosing ? 0.18 : 0.24;
  const height = isCover ? 0.3 : isClosing ? 0.32 : 0.52;

  const specs =
    count === 1
      ? [{ x: 0.1, y: top, width: 0.8, height }]
      : count === 2
        ? [
            { x: 0.08, y: top, width: 0.4, height },
            { x: 0.52, y: top, width: 0.4, height },
          ]
        : count === 3
          ? [
              { x: 0.08, y: top, width: 0.52, height },
              { x: 0.64, y: top, width: 0.28, height: height * 0.48 },
              { x: 0.64, y: top + height * 0.52, width: 0.28, height: height * 0.48 },
            ]
          : count === 4
            ? [
                { x: 0.08, y: top, width: 0.4, height: height * 0.48 },
                { x: 0.52, y: top, width: 0.4, height: height * 0.48 },
                { x: 0.08, y: top + height * 0.52, width: 0.4, height: height * 0.48 },
                { x: 0.52, y: top + height * 0.52, width: 0.4, height: height * 0.48 },
              ]
            : [
                { x: 0.08, y: top, width: 0.4, height: height * 0.3 },
                { x: 0.52, y: top, width: 0.4, height: height * 0.3 },
                { x: 0.08, y: top + height * 0.35, width: 0.4, height: height * 0.3 },
                { x: 0.52, y: top + height * 0.35, width: 0.4, height: height * 0.3 },
                { x: 0.08, y: top + height * 0.7, width: 0.4, height: height * 0.3 },
                { x: 0.52, y: top + height * 0.7, width: 0.4, height: height * 0.3 },
              ];

  return unique.map((path, i) => ({
    path,
    ...specs[i],
    fit: "cover",
    radius: 24,
    borderWidth: 8,
    borderColor: "#ffffff",
  }));
}

export async function compositeOriginalPhotos(opts: {
  background: AnyBuffer;
  photos: PhotoInput[];
  frames: NormalizedPhotoFrame[];
}): Promise<AnyBuffer> {
  const metadata = await sharp(opts.background).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1536;
  const photosByPath = new Map(opts.photos.map((p) => [p.path, p]));

  const layers = [];
  for (const frame of opts.frames) {
    const photo = photosByPath.get(frame.path);
    if (!photo) continue;
    const rect = pxFrame(frame, width, height);
    const input = await renderPhotoFrame(photo, frame, rect.width, rect.height);
    layers.push({ input, left: rect.left, top: rect.top });
  }

  if (layers.length === 0) return opts.background;
  return sharp(opts.background).composite(layers).png().toBuffer();
}
