import "server-only";

/**
 * Logo analysis (sharp). The components that PLACE the logo — the creative agent
 * and the composition writer — otherwise never see its pixels, so they can't tell
 * a dark logo from a light one and end up dropping a dark logo onto a dark
 * background (invisible). We measure the logo here and pass the facts downstream.
 */

export type LogoProfile = {
  /** Overall lightness of the visible (opaque) logo pixels. */
  tone: "dark" | "light" | "mixed";
  /** Has meaningful transparency (so it needs a backing on busy/dark media). */
  hasTransparency: boolean;
  /**
   * The background the logo needs to stay legible:
   *  - "light": dark logo → must sit on a light/white surface
   *  - "dark":  light logo → must sit on a dark surface
   *  - "any":   opaque logo carries its own background → fine anywhere
   */
  requiredBackground: "light" | "dark" | "any";
};

/** Classify a logo's tone + transparency so callers can guarantee contrast. */
export async function analyzeLogo(buffer: Buffer): Promise<LogoProfile | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(buffer)
      .resize(48, 48, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;

    let opaque = 0;
    let transparent = 0;
    let lumSum = 0;
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const a = ch >= 4 ? data[i + 3] : 255;
      if (a < 128) { transparent++; continue; }
      opaque++;
      lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b; // relative luminance, 0..255
    }
    if (opaque === 0) return null;

    const meanLum = lumSum / opaque;
    const total = opaque + transparent;
    const hasTransparency = total > 0 && transparent / total > 0.05;

    const tone: LogoProfile["tone"] =
      meanLum < 100 ? "dark" : meanLum > 165 ? "light" : "mixed";

    // An opaque logo carries its own background → readable anywhere. A logo with
    // real transparency shows the canvas behind it, so it needs a contrasting
    // surface: dark mark → light bg; light mark → dark bg; mixed → light (safest).
    let requiredBackground: LogoProfile["requiredBackground"];
    if (!hasTransparency) requiredBackground = "any";
    else if (tone === "light") requiredBackground = "dark";
    else requiredBackground = "light";

    return { tone, hasTransparency, requiredBackground };
  } catch {
    return null;
  }
}

/**
 * Extract a few dominant anchor colours (hex) from a logo image, so the creative
 * director can keep palettes on-brand. Downscales to a tiny grid, ignores
 * transparent/near-white/near-black pixels, buckets the rest, returns the most
 * common. Best-effort — returns [] on any failure.
 */
export async function extractBrandColors(buffer: Buffer, max = 3): Promise<string[]> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(buffer)
      .resize(24, 24, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const a = ch >= 4 ? data[i + 3] : 255;
      if (a < 128) continue;                       // transparent
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (hi > 240 && lo > 240) continue;          // near-white (background)
      if (hi < 24) continue;                        // near-black
      const key = `${Math.round(r / 32)},${Math.round(g / 32)},${Math.round(b / 32)}`;
      const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
      e.r += r; e.g += g; e.b += b; e.n++;
      buckets.set(key, e);
    }
    return [...buckets.values()]
      .sort((x, y) => y.n - x.n)
      .slice(0, max)
      .map((e) => {
        const c = (v: number) => Math.round(v / e.n).toString(16).padStart(2, "0");
        return `#${c(e.r)}${c(e.g)}${c(e.b)}`;
      });
  } catch {
    return [];
  }
}
