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

export type BrandImageInput = {
  assetType: string;
  buffer: AnyBuffer;
};

export type DeterministicPosterInput = {
  schoolName: string;
  headline: string;
  subheadline?: string;
  theme: string;
  palette: string[];
  pageIndex: number;
  totalPages: number;
  photos: PhotoInput[];
  frames: NormalizedPhotoFrame[];
  brandImages: BrandImageInput[];
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

const CANVAS_W = 1024;
const CANVAS_H = 1536;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  return /^#[0-9a-f]{6}$/i.test(input) ? input : fallback;
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : [text];
}

function svgTextBlock(opts: {
  text: string;
  x: number;
  y: number;
  maxChars: number;
  maxLines: number;
  fontSize: number;
  lineHeight: number;
  weight: number;
  color: string;
  anchor?: "start" | "middle";
  family?: string;
}): string {
  const lines = wrapText(opts.text, opts.maxChars, opts.maxLines);
  const anchor = opts.anchor ?? "start";
  const family = opts.family ?? "Arial, Helvetica, sans-serif";
  return `<text x="${opts.x}" y="${opts.y}" fill="${opts.color}" font-family="${family}" font-size="${opts.fontSize}" font-weight="${opts.weight}" text-anchor="${anchor}">
${lines.map((line, i) => `<tspan x="${opts.x}" dy="${i === 0 ? 0 : opts.lineHeight}">${escapeXml(line)}</tspan>`).join("\n")}
</text>`;
}

function framePlaceholders(frames: NormalizedPhotoFrame[]): string {
  return frames
    .map((f) => {
      const x = Math.round(f.x * CANVAS_W);
      const y = Math.round(f.y * CANVAS_H);
      const w = Math.round(f.width * CANVAS_W);
      const h = Math.round(f.height * CANVAS_H);
      const r = Math.round(f.radius ?? 24);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#fffaf0" stroke="#ffffff" stroke-width="${f.borderWidth ?? 8}" filter="url(#shadow)"/>`;
    })
    .join("\n");
}

function backgroundSvg(input: DeterministicPosterInput): string {
  const primary = pickColor(input.palette[0], "#172a6a");
  const accent = pickColor(input.palette[1], "#c89d3f");
  const isCover = input.totalPages > 1 && input.pageIndex === 0;
  const isClosing = input.totalPages > 1 && input.pageIndex === input.totalPages - 1;
  const isMiddle = input.totalPages > 1 && !isCover && !isClosing;

  const headlineY = isCover ? 300 : isMiddle ? 190 : 960;
  const headlineSize = isMiddle ? 74 : 82;
  const headlineAnchor = isClosing ? "middle" : "start";
  const headlineX = isClosing ? CANVAS_W / 2 : 88;
  const headlineChars = isMiddle ? 18 : 15;
  const headlineLines = isMiddle ? 2 : 3;
  const subY = isClosing ? 1160 : isCover ? 1110 : 1310;
  const subX = isClosing ? CANVAS_W / 2 : CANVAS_W / 2;

  return `<svg width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#fff8e8"/>
    <stop offset="58%" stop-color="#fffdf6"/>
    <stop offset="100%" stop-color="#f3e8cf"/>
  </linearGradient>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#2a2a2a" flood-opacity="0.18"/>
  </filter>
</defs>
<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#paper)"/>
<rect x="20" y="20" width="${CANVAS_W - 40}" height="${CANVAS_H - 40}" rx="18" fill="none" stroke="${accent}" stroke-width="3"/>
<circle cx="900" cy="250" r="170" fill="none" stroke="${accent}" stroke-opacity="0.22" stroke-width="3"/>
<circle cx="105" cy="1160" r="130" fill="none" stroke="${primary}" stroke-opacity="0.10" stroke-width="2"/>
<path d="M55 330 C140 250 180 190 255 110" fill="none" stroke="${primary}" stroke-opacity="0.08" stroke-width="28"/>
<path d="M720 1110 C790 1075 860 1075 940 1110" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="4"/>
<text x="${CANVAS_W / 2}" y="205" text-anchor="middle" fill="${primary}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">${escapeXml(input.schoolName)}</text>
${svgTextBlock({
  text: input.headline,
  x: headlineX,
  y: headlineY,
  maxChars: headlineChars,
  maxLines: headlineLines,
  fontSize: headlineSize,
  lineHeight: headlineSize * 0.95,
  weight: 900,
  color: primary,
  anchor: headlineAnchor,
})}
${input.subheadline ? svgTextBlock({
  text: input.subheadline,
  x: subX,
  y: subY,
  maxChars: 42,
  maxLines: 2,
  fontSize: 30,
  lineHeight: 40,
  weight: 700,
  color: accent,
  anchor: "middle",
}) : ""}
${framePlaceholders(input.frames)}
<rect x="0" y="${CANVAS_H - 116}" width="${CANVAS_W}" height="116" fill="${primary}"/>
<text x="250" y="${CANVAS_H - 48}" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">080-28392711</text>
<text x="720" y="${CANVAS_H - 48}" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">www.stmarys-school.in</text>
</svg>`;
}

async function renderBrandLayers(brandImages: BrandImageInput[]) {
  const layers: { input: AnyBuffer; left: number; top: number }[] = [];
  const logo = brandImages.find((b) => b.assetType === "logo") ?? brandImages.find((b) => b.assetType === "header");
  if (logo) {
    const input = await sharp(logo.buffer)
      .rotate()
      .resize(250, 120, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    layers.push({ input, left: Math.round((CANVAS_W - 250) / 2), top: 70 });
  }
  return layers;
}

export async function renderDeterministicPosterPage(input: DeterministicPosterInput): Promise<AnyBuffer> {
  const background = await sharp(Buffer.from(backgroundSvg(input))).png().toBuffer();
  const withBrand = await sharp(background)
    .composite(await renderBrandLayers(input.brandImages))
    .png()
    .toBuffer();
  return compositeOriginalPhotos({
    background: withBrand,
    photos: input.photos,
    frames: input.frames,
  });
}
