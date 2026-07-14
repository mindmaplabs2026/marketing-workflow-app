import "server-only";
import { withRateLimitRetry } from "./openai-client";
import { getModelClient } from "./model-client";
import { PosterDocSchema, type PosterDoc, type PosterPalette, type PosterPage, type PosterBand } from "./poster-doc";
import { fontMenu } from "./poster-schema-renderer";
import type { VariationBrief } from "./agent-creative";
import type { CostTracker } from "./cost-tracker";

/** Input for building a PosterDoc — a subset of Agent 3's input. */
export type PosterDocInput = {
  brief: VariationBrief;
  schoolName: string;
  /** Paths of photos actually available to composite (validates photoGrid refs). */
  availablePhotoPaths: string[];
};

// ── Colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  const s = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function relLum(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const l1 = relLum(a), l2 = relLum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
function saturation(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

const DEFAULT_PALETTE: PosterPalette = { bg: "#f7f1e1", ink: "#14284b", accent: "#8a1c24", accent2: "#e0a924", muted: "#b8ad8f" };

/** Map a brief's flat colour list into named palette roles by luminance/saturation. */
function derivePalette(colors: string[]): PosterPalette {
  const valid = (colors ?? []).map((c) => c?.trim()).filter((c): c is string => !!c && !!hexToRgb(c));
  if (valid.length < 2) return DEFAULT_PALETTE;
  const byLum = [...valid].sort((a, b) => relLum(b) - relLum(a));
  const bg = byLum[0];
  const ink = byLum[byLum.length - 1];
  const rest = valid.filter((c) => c !== bg && c !== ink);
  const bySat = [...(rest.length ? rest : valid)].sort((a, b) => saturation(b) - saturation(a));
  const accent = bySat[0] ?? DEFAULT_PALETTE.accent;
  const accent2 = bySat[1] ?? DEFAULT_PALETTE.accent2;
  const muted = bySat[Math.floor(bySat.length / 2)] ?? DEFAULT_PALETTE.muted;
  return { bg, ink, accent, accent2, muted };
}

/** Best-contrast palette role for text over the given background colour. */
function contrastText(bg: string, palette: PosterPalette, prefer: (keyof PosterPalette)[]): keyof PosterPalette {
  const bgHex = (palette as Record<string, string>)[bg] ?? bg;
  const candidates: (keyof PosterPalette)[] = [...prefer, "ink", "bg", "accent2", "accent"];
  let best: keyof PosterPalette = prefer[0] ?? "ink";
  let bestC = 0;
  for (const role of candidates) {
    const c = contrast((palette as Record<string, string>)[role], bgHex);
    if (c > bestC) { bestC = c; best = role; }
  }
  return best;
}

// ── Font selection from the curated menu ─────────────────────────────────────
function familiesByCategory(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of fontMenu()) (out[f.category] ??= []).push(f.family);
  return out;
}
function pick(list: string[] | undefined, fallback: string): string {
  return list && list.length ? list[0] : fallback;
}

function categoryOf(family: string): string | undefined {
  return fontMenu().find((f) => f.family.toLowerCase() === family.toLowerCase())?.category;
}

/** The typography prose Agent 2 wrote (top-level creativeVision) — not on the
 *  VariationBrief type but present at runtime. */
function visionText(brief: VariationBrief): string {
  const cv = (brief as unknown as { creativeVision?: string }).creativeVision ?? "";
  return `${cv} ${brief.designPrompt ?? ""}`;
}

/** Honour Agent 2: pull any curated-menu font families named in its brief. */
function extractFonts(brief: VariationBrief): { heading?: string; accent?: string } {
  const text = visionText(brief).toLowerCase();
  const matches: string[] = [];
  for (const f of fontMenu()) {
    if (text.includes(f.family.toLowerCase()) && !matches.includes(f.family)) matches.push(f.family);
  }
  if (!matches.length) return {};
  const heading = matches.find((m) => ["sans-heading", "display", "serif", "rounded"].includes(categoryOf(m) ?? "")) ?? matches[0];
  const accent = matches.find((m) => m !== heading);
  return { heading, accent };
}

/** Pull a phone number + website out of Agent 2's contact/branding text. */
function parseContact(brief: VariationBrief): { phone?: string; website?: string } {
  const src = `${brief.brandingPlacement?.contactInfo ?? ""} ${brief.brandingPlacement?.affiliations ?? ""} ${brief.textContent?.bodyText ?? ""}`;
  const phone = src.match(/\+?\d[\d\s()/-]{7,}\d/)?.[0]?.replace(/\s{2,}/g, " ").trim();
  const website = src.match(/(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?/i)?.[0]?.trim();
  return { phone, website };
}

/** Choose heading/body/accent fonts — honouring Agent 2's named fonts first,
 *  then falling back to a theme-keyword heuristic. */
function pickFonts(brief: VariationBrief): { heading: string; body: string; accent: string } {
  const cat = familiesByCategory();
  const base = pickFontsByKeyword(brief);
  const named = extractFonts(brief);
  return {
    heading: named.heading ?? base.heading,
    body: base.body,
    accent: named.accent ?? base.accent ?? pick(cat.display, "Oswald"),
  };
}

function pickFontsByKeyword(brief: VariationBrief): { heading: string; body: string; accent: string } {
  const cat = familiesByCategory();
  const t = `${brief.theme} ${brief.direction} ${brief.designPrompt}`.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => t.includes(k));
  if (has("elegant", "premium", "heritage", "formal", "classic", "graduation", "prestige")) {
    return { heading: pick(cat.serif, "Playfair Display"), body: pick(cat["sans-body"], "Lato"), accent: cat.serif?.[1] ?? "Cormorant Garamond" };
  }
  if (has("playful", "kids", "fun", "celebration", "joy", "colorful", "festive", "carnival")) {
    return { heading: pick(cat.rounded, "Fredoka"), body: pick(cat["sans-body"], "Work Sans"), accent: pick(cat.display, "Oswald") };
  }
  if (has("bold", "sport", "energy", "impact", "power", "champion", "strong")) {
    return { heading: pick(cat["sans-heading"], "Barlow"), body: pick(cat["sans-body"], "Work Sans"), accent: pick(cat.display, "Bebas Neue") };
  }
  // Modern default.
  return { heading: pick(cat["sans-heading"], "Montserrat"), body: cat["sans-heading"]?.[1] ?? "Poppins", accent: pick(cat.display, "Oswald") };
}

function pickDecor(brief: VariationBrief): ("arcs" | "dots" | "corners" | "bars")[] {
  const t = `${brief.theme} ${brief.direction}`.toLowerCase();
  if (/elegant|premium|heritage|formal|classic|graduation/.test(t)) return ["arcs", "dots"];
  if (/playful|kids|fun|celebration|festive/.test(t)) return ["dots", "bars"];
  if (/bold|sport|energy|impact/.test(t)) return ["corners", "bars"];
  return ["dots", "corners"];
}

const VALID_FAMILIES = new Set(fontMenu().map((f) => f.family.toLowerCase()));

/**
 * Layouts that fill COMPLETELY for a given photo count — no blank/orphan cell.
 * This is the hard rule: the AI may pick any of these for variety, but a layout
 * that would leave a gap for the count is never allowed. Order = preference.
 */
function balancedLayouts(n: number): string[] {
  if (n <= 1) return ["single"];
  if (n === 2) return ["duo", "duoV"];
  if (n === 3) return ["trio", "trioRow"];
  if (n === 4) return ["quad", "quadFeature"];
  if (n === 5) return ["featured", "hero-strip"];
  return ["mosaic6", "grid6"]; // 6
}

// ── Deterministic builder (fallback + safety net) ────────────────────────────
function shorten(s: string | undefined, words: number): string {
  return (s ?? "").trim().split(/\s+/).slice(0, words).join(" ");
}

/** Build a valid, sensible PosterDoc from the brief with zero AI. */
export function briefToPosterDoc(input: PosterDocInput): PosterDoc {
  const { brief } = input;
  const palette = derivePalette(brief.colorPalette);
  const fonts = pickFonts(brief);
  const decor = pickDecor(brief);
  const isCarousel = brief.layout.type === "carousel" && brief.layout.pages.length > 1;
  const total = isCarousel ? brief.layout.pages.length : 1;
  const avail = new Set(input.availablePhotoPaths);

  const pathsFor = (pageIdx: number): string[] => {
    const page = brief.layout.pages[pageIdx];
    const raw = (page?.selectedImages ?? []).map((s) => s.path).filter(Boolean);
    const list = (raw.length ? raw : brief.selectedImages.map((s) => s.path)).filter((p) => avail.has(p));
    return [...new Set(list)].slice(0, 6);
  };

  const pages = brief.layout.pages.slice(0, total).map((page, i) => {
    const isCover = i === 0;
    const isClosing = isCarousel && i === total - 1;
    const photos = pathsFor(i);
    const bands: PosterDoc["pages"][number]["bands"] = [];

    if (isCover) {
      bands.push({ type: "eyebrow", text: (brief.theme || "").toUpperCase().slice(0, 42), color: "ink" });
      bands.push({ type: "divider", style: "line-diamond", color: "accent2" });
      const words = brief.textContent.headline.trim().split(/\s+/);
      const mid = Math.ceil(words.length / 2);
      const lines = words.length > 2
        ? [{ text: words.slice(0, mid).join(" "), color: "accent" }, { text: words.slice(mid).join(" "), color: "accent2" }]
        : [{ text: brief.textContent.headline, color: "accent" }];
      bands.push({ type: "heading", lines });
      if (brief.textContent.subheadline) bands.push({ type: "subheading", text: brief.textContent.subheadline, color: "ink" });
      if (photos.length) bands.push({ type: "photoGrid", photos, frameStyle: "card", flex: 1 });
      else bands.push({ type: "spacer", flex: 1 });
    } else if (isClosing) {
      if (photos.length) bands.push({ type: "photoGrid", photos, frameStyle: "card", flex: 1 });
      else bands.push({ type: "spacer", flex: 1 });
      bands.push({ type: "heading", lines: [{ text: shorten(page.description, 4) || "Thank You", color: "accent" }], size: 60 });
      const tag = brief.textContent.callToAction || brief.textContent.subheadline;
      if (tag) bands.push({ type: "subheading", text: tag, color: "ink" });
    } else {
      // Middle page: title + collage.
      bands.push({ type: "heading", lines: [{ text: (shorten(page.description, 4) || "Highlights").toUpperCase(), color: "ink" }], size: 62 });
      if (brief.textContent.subheadline && i === 1) bands.push({ type: "subheading", text: brief.textContent.subheadline, color: "accent" });
      bands.push({ type: "divider", style: "line-diamond", color: "accent2" });
      if (photos.length) bands.push({ type: "photoGrid", photos, flex: 1 });
      else bands.push({ type: "spacer", flex: 1 });
    }

    return {
      id: page.description ? shorten(page.description, 3).toLowerCase().replace(/\s+/g, "-") || `page-${i + 1}` : `page-${i + 1}`,
      background: { type: "color" as const, color: "bg" },
      reserveLogo: true,
      reserveFooter: true,
      decor,
      bands,
    };
  });

  return { version: 1, palette, fonts, pages };
}

// ── Sanitiser — harden any PosterDoc (Codex or fallback) ─────────────────────
function nearestFamily(name: string, role: "heading" | "body" | "accent"): string {
  if (VALID_FAMILIES.has(name?.toLowerCase())) return name;
  const cat = familiesByCategory();
  if (role === "body") return pick(cat["sans-body"], "Lato");
  if (role === "accent") return pick(cat.display, "Oswald");
  return pick(cat["sans-heading"], "Montserrat");
}

/** Harden any PosterDoc (Codex or deterministic) and enforce a consistent
 *  system across pages. Coerces fonts to the menu (honouring Agent 2's named
 *  fonts), guarantees palette roles + brand zones + valid photos, forces
 *  balanced (orphan-free) photo layouts, sizes headings big-and-consistent,
 *  unifies decor/icon colour/heading scheme across pages, fixes low-contrast
 *  text, and attaches a native contact footer. */
export function sanitize(doc: PosterDoc, input: PosterDocInput): PosterDoc {
  const palette: PosterPalette = { ...DEFAULT_PALETTE, ...doc.palette };

  // Fonts: honour Agent 2's named fonts, else the doc's (coerced to the menu).
  const named = extractFonts(input.brief);
  const fonts = {
    heading: nearestFamily(named.heading ?? doc.fonts?.heading, "heading"),
    body: nearestFamily(doc.fonts?.body, "body"),
    accent: nearestFamily(named.accent ?? doc.fonts?.accent ?? "", "accent"),
  };

  // One consistent system for the whole set.
  const decor = (doc.pages.find((p) => p.decor?.length)?.decor ?? ["dots", "corners"]) as PosterPage["decor"];
  const iconColor = "accent2";
  const footer = doc.footer ?? footerFromBrief(input.brief);

  const avail = new Set(input.availablePhotoPaths);
  const isDark = (bgRef: string) => relLum((palette as Record<string, string>)[bgRef] ?? bgRef) < 0.4;
  // De-clone consecutive same-count collages so two 6-photo pages don't look identical.
  const lastLayoutByCount = new Map<number, string>();

  const pages = doc.pages.map((page, i) => {
    const bgRef = page.background.type === "color" ? page.background.color
      : page.background.type === "split" ? page.background.color1
        : page.background.from;
    const dark = isDark(bgRef);
    const pref: (keyof PosterPalette)[] = dark ? ["bg", "accent2", "accent"] : ["ink", "accent", "accent2"];

    const fixColor = (c: string | undefined, fallbackPrefer: (keyof PosterPalette)[]): string => {
      const resolved = (palette as Record<string, string>)[c ?? ""] ?? c;
      const bgHex = (palette as Record<string, string>)[bgRef] ?? bgRef;
      if (resolved && contrast(resolved, bgHex) >= 3) return c!; // keep good choices
      return contrastText(bgRef, palette, fallbackPrefer);
    };

    // Consistent heading scale by page role: cover dominant, others uniform.
    const headingSize = i === 0 ? 112 : 74;
    // Consistent two-tone heading colour scheme across every page.
    const headingColorFor = (idx: number): string => {
      const role = idx === 0 ? (dark ? "bg" : "accent") : "accent2";
      return fixColor(role, pref);
    };

    const bands = page.bands.map((b) => {
      if (b.type === "heading") {
        return { ...b, size: headingSize, lines: b.lines.map((ln, li) => ({ ...ln, color: headingColorFor(li) })) };
      }
      if (b.type === "eyebrow" || b.type === "subheading" || b.type === "textBlock" || b.type === "chip") {
        return { ...b, color: fixColor((b as { color?: string }).color, pref) };
      }
      if (b.type === "iconRow") return { ...b, color: iconColor };
      if (b.type === "photoGrid") {
        const photos = (b.photos.filter((p) => avail.has(p)).length ? b.photos.filter((p) => avail.has(p)) : b.photos).slice(0, 6);
        const opts = balancedLayouts(photos.length);
        // Hard rule: only an orphan-free layout may be used. Respect the AI's
        // choice if it fills cleanly, else pick a clean one by page position.
        let chosen = b.layout && opts.includes(b.layout) ? b.layout : opts[i % opts.length];
        // De-clone: if the previous same-count page used this exact layout, swap.
        if (opts.length > 1 && lastLayoutByCount.get(photos.length) === chosen) {
          chosen = opts[(opts.indexOf(chosen) + 1) % opts.length];
        }
        lastLayoutByCount.set(photos.length, chosen);
        return { ...b, photos, layout: chosen as typeof b.layout };
      }
      return b;
    }).filter((b) => !(b.type === "photoGrid" && b.photos.length === 0));

    return { ...page, reserveLogo: true, reserveFooter: true, decor, bands: bands.length ? bands : page.bands };
  });

  // Titles must be DISTINCT — Codex sometimes repeats the cover headline on
  // every page. Standardise style, not text: keep the cover's headline, and give
  // any duplicated non-cover page its own title from Agent 2's page description.
  // Also drop a middle page's subheading when it just echoes the cover's tagline.
  const headingKey = (b: PosterBand) => (b.type === "heading" ? b.lines.map((l) => l.text).join(" ").trim().toLowerCase() : "");
  const coverSub = (() => {
    const b = pages[0]?.bands.find((x) => x.type === "subheading");
    return b && b.type === "subheading" ? b.text.trim().toLowerCase() : "";
  })();
  const seenHeadings = new Set<string>();
  const lastIndex = pages.length - 1;
  const distinctPages = pages.map((page, i) => {
    const bands = page.bands.flatMap((b) => {
      if (b.type === "heading") {
        const key = headingKey(b);
        if (i > 0 && key && seenHeadings.has(key)) {
          const desc = input.brief.layout.pages[i]?.description ?? "";
          const title = (shorten(desc, 4) || "Highlights").toUpperCase();
          return [{ ...b, lines: [{ text: title, color: b.lines[0]?.color }] }];
        }
        seenHeadings.add(key);
      }
      // Drop a repeated tagline subheading on middle pages (keep cover + closing).
      if (b.type === "subheading" && i > 0 && i < lastIndex && coverSub && b.text.trim().toLowerCase() === coverSub) {
        return [];
      }
      return [b];
    });
    return { ...page, bands: bands.length ? bands : page.bands };
  });

  return { version: 1, palette, fonts, footer, pages: distinctPages };
}

/** Build the native footer from Agent 2's contact info (undefined if none). */
function footerFromBrief(brief: VariationBrief): PosterDoc["footer"] {
  const { phone, website } = parseContact(brief);
  if (!phone && !website) return undefined;
  return { phone, website, background: "accent", color: "bg" };
}

// ── Codex-authored generation ────────────────────────────────────────────────
function buildPrompt(input: PosterDocInput): string {
  const { brief } = input;
  const cats = familiesByCategory();
  const menu = Object.entries(cats).map(([c, fs]) => `  ${c}: ${fs.join(", ")}`).join("\n");
  const isCarousel = brief.layout.type === "carousel" && brief.layout.pages.length > 1;
  const pagesSpec = brief.layout.pages.slice(0, isCarousel ? brief.layout.pages.length : 1).map((p, i) => {
    const photos = (p.selectedImages ?? []).map((s) => s.path).filter((path) => input.availablePhotoPaths.includes(path));
    const role = i === 0 ? "COVER" : isCarousel && i === brief.layout.pages.length - 1 ? "CLOSING" : "MIDDLE";
    return `Page ${i + 1} [${role}]\n  vision: ${(p.creativeVision || p.description || "").slice(0, 300)}\n  photos (use these EXACT paths in photoGrid, in this order): ${JSON.stringify(photos)}`;
  }).join("\n");

  return `You are a senior poster designer. Produce a PosterDoc JSON for a school Instagram poster (${isCarousel ? `${brief.layout.pages.length}-page carousel` : "single page"}). A fixed renderer turns this JSON into the image — you choose CONTENT, STRUCTURE, COLOUR and FONTS; it computes all geometry, so you never give coordinates.

School: ${input.schoolName}
Theme: ${brief.theme}
Direction: ${brief.direction}
Headline: ${brief.textContent.headline}
Subheadline: ${brief.textContent.subheadline}
Call to action: ${brief.textContent.callToAction}
Brand palette (hex): ${brief.colorPalette.join(", ")}
Art director's typography + style notes (HONOUR these — if a named font is in the menu, use it): ${visionText(brief).slice(0, 500)}
Recommended fonts (from the notes, already matched to the menu): heading=${pickFonts(brief).heading}, accent=${pickFonts(brief).accent}

Pages:
${pagesSpec}

OUTPUT — a JSON object exactly matching this shape:
{
  "version": 1,
  "palette": { "bg": hex, "ink": hex, "accent": hex, "accent2": hex, "muted": hex },
  "fonts": { "heading": <family>, "body": <family>, "accent": <family> },
  "pages": [ {
    "id": string,
    "background": { "type":"color","color":<hex|role> } | { "type":"gradient","from":..,"to":..,"angle":num } | { "type":"split","color1":..,"color2":..,"direction":"diagonal|horizontal|vertical","ratio":num },
    "reserveLogo": true, "reserveFooter": true,
    "decor": array of any of ["arcs","dots","corners","bars"],
    "bands": [ ...ordered bands... ]
  } ]
}
BANDS (each has optional "align": left|center|right):
  { "type":"eyebrow","text":..,"color":role }                         small-caps label
  { "type":"heading","lines":[{ "text":..,"color":role }],"size":num } 1-3 lines; per-line colour = two-tone titles
  { "type":"subheading","text":..,"color":role }
  { "type":"chip","text":..,"background":role,"color":role }
  { "type":"divider","style":"line-diamond|line","color":role }
  { "type":"photoGrid","photos":[paths],"layout":"single|duo|trio|quad|quadFeature|featured|mosaic6|grid6|hero-strip","frameStyle":"plain|card","flex":1 }
  { "type":"iconRow","icons":[any of heart,star,people,book,trophy,bulb,flag,medal],"color":role }
  { "type":"spacer","flex":1 }

FONTS — choose families ONLY from this menu (exact names):
${menu}

RULES:
- Colour values may be a hex OR a palette role name ("bg","ink","accent","accent2","muted").
- CONTRAST IS CRITICAL: every text colour must clearly contrast with its page background. On a light background use dark text (ink/accent); on a dark background use light text (bg/accent2). Never put dark text on a dark background or light on light.
- BIG, BOLD HEADINGS: the cover headline should dominate the page — set a large heading "size" (~110). Make it two-tone (per-line colour). Middle/closing headings are smaller (~74) but still strong.
- ONE CONSISTENT VISUAL SYSTEM across ALL pages: SAME "decor" array, SAME heading colour scheme, SAME icon colour, SAME background treatment. Standardise STYLE, NOT TEXT.
- DISTINCT PER-PAGE TITLES: only the COVER shows the main headline. Every other page MUST have its OWN short heading that describes THAT page's content (from its vision) — e.g. "Formal Recognition", "Voice and Oath", "March and Celebrate". NEVER repeat the cover headline on later pages, and do NOT put the same subheading/tagline on every page.
- The top-left LOGO is composited automatically, and the bottom CONTACT FOOTER is drawn automatically from the school's details. Always set reserveLogo & reserveFooter true; NEVER add a logo, footer, or contact band yourself, and never draw a coloured band across the bottom.
- photoGrid.photos MUST be the exact paths listed for that page, in order. Omit photoGrid if a page has none. You MAY set "layout" to vary the collage between pages (e.g. mosaic6 vs grid6 for 6 photos, quad vs quadFeature for 4) — but it is only honoured if it fills the photo count with NO blank cell; otherwise the renderer substitutes a clean layout. Prefer varying it so consecutive photo pages don't look identical.
- COVER: eyebrow + divider + a strong two-tone heading + subheading + a photoGrid (frameStyle "card"). MIDDLE: a title + divider + a photoGrid collage. CLOSING: a photoGrid + heading + subheading (+ optional iconRow).
- Keep headlines short (<= 6 words). Return ONLY the JSON, no markdown.`;
}

/**
 * Generate a PosterDoc: Codex authors it, we zod-validate + sanitise, and fall
 * back to the deterministic builder if anything is malformed.
 */
export async function generatePosterDoc(input: PosterDocInput, costTracker?: CostTracker): Promise<PosterDoc> {
  const openai = await getModelClient();
  const prompt = buildPrompt(input);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await withRateLimitRetry(() => openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You output only valid PosterDoc JSON for a fixed poster renderer. No markdown, no prose." },
          { role: "user", content: attempt === 0 ? prompt : `${prompt}\n\nYour previous output was invalid JSON or failed schema validation. Return ONLY a valid JSON object.` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 4000,
      }));
      costTracker?.addLLMCall(`agent_poster_doc_v3${attempt ? "_retry" : ""}`, "gpt-4o-mini", response.usage);
      const raw = response.choices[0]?.message?.content ?? "";
      const json = JSON.parse(raw.replace(/```(?:json)?/gi, "").trim());
      const parsed = PosterDocSchema.safeParse(json);
      if (parsed.success) {
        console.log(`[PosterDoc] Codex authored a valid PosterDoc (${parsed.data.pages.length} page(s))`);
        return sanitize(parsed.data, input);
      }
      console.warn(`[PosterDoc] attempt ${attempt + 1} failed schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    } catch (err) {
      console.warn(`[PosterDoc] attempt ${attempt + 1} error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.warn("[PosterDoc] Codex generation failed — using deterministic briefToPosterDoc fallback");
  return sanitize(briefToPosterDoc(input), input);
}
