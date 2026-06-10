/**
 * Codex Poster Bridge — swappable model client.
 *
 * The agents call this instead of getOpenAI(). It returns an object shaped
 * exactly like the OpenAI SDK, so EVERY existing agent call site stays
 * byte-for-byte identical — only the source of the client changes.
 *
 *   MODEL_ENGINE=openai (default) → the real OpenAI client. Provably identical
 *                                   to today's behaviour.
 *   MODEL_ENGINE=codex            → a stub (current stage): text calls pass
 *                                   through to the real client so agents still
 *                                   get valid JSON, while images.edit/generate
 *                                   return a placeholder PNG (no paid image
 *                                   call). Phase 5 replaces the image (then
 *                                   text) methods with real Codex calls — and
 *                                   nothing outside THIS file changes.
 *
 * Note: this module deliberately does NOT import "server-only" or the
 * server-only openai-client, so the standalone worker (plain Node) can import
 * it. The agent files keep their own "server-only" guard for the Next app.
 */
import zlib from "node:zlib";
import OpenAI from "openai";
import { getModelEngineKind } from "../config/engine";

// --- Placeholder PNG generator (stub stage) --------------------------------
// A real, poster-sized solid-color PNG. Must be big enough that the evaluator's
// vision call (which still runs on real OpenAI in the stub stage) accepts it —
// a 1×1 image is rejected as "unsupported".
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePlaceholderPng(width = 1024, height = 1536): string {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  // Vertical gradient (real pixel variation) — a flat single color can be
  // flagged "unsupported" by the vision API; a gradient is reliably accepted.
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const r = Math.round(150 + 90 * t);
    const g = Math.round(200 - 50 * t);
    const b = Math.round(235 - 30 * t);
    const row = Buffer.alloc(1 + width * 3); // filter byte + RGB pixels
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = r; row[1 + x * 3 + 1] = g; row[1 + x * 3 + 2] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const png = Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return png.toString("base64");
}

/** Poster-sized placeholder PNG — generated once, valid for vision + preview. */
const PLACEHOLDER_PNG_BASE64 = makePlaceholderPng();

let realClient: OpenAI | null = null;

function getRealOpenAI(): OpenAI {
  if (realClient) return realClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  realClient = new OpenAI({ apiKey });
  return realClient;
}

/**
 * Wraps the real client so that `.images.edit` / `.images.generate` return a
 * placeholder instead of calling the paid image API. Everything else
 * (`.chat`, `.responses`, …) passes straight through.
 */
function makeCodexStubClient(base: OpenAI): OpenAI {
  const stubImages = {
    async edit() {
      console.warn("[codex-stub] images.edit → placeholder PNG (no real generation yet)");
      return { data: [{ b64_json: PLACEHOLDER_PNG_BASE64 }] };
    },
    async generate() {
      console.warn("[codex-stub] images.generate → placeholder PNG (no real generation yet)");
      return { data: [{ b64_json: PLACEHOLDER_PNG_BASE64 }] };
    },
  };

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "images") return stubImages;
      return Reflect.get(target, prop, receiver);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as OpenAI;
}

let cached: OpenAI | null = null;

/** Returns the model client selected by MODEL_ENGINE (cached per process). */
export async function getModelClient(): Promise<OpenAI> {
  if (cached) return cached;
  if (getModelEngineKind() === "codex") {
    cached = makeCodexStubClient(getRealOpenAI());
    console.log("[model-client] engine: codex (stub — real text, placeholder images)");
  } else {
    cached = getRealOpenAI();
    console.log("[model-client] engine: openai");
  }
  return cached;
}

/** Test/worker helper: clear the cached client (e.g. after changing env). */
export function resetModelClientCache(): void {
  cached = null;
  realClient = null;
}
