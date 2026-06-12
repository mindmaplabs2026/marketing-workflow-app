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
 * Extract { name, buffer } from the OpenAI `image` argument (a File / FileLike,
 * or an array of them — what the agents build via toFile()).
 */
async function filesToRefs(image: unknown): Promise<{ name: string; buffer: Buffer }[]> {
  const arr = Array.isArray(image) ? image : image != null ? [image] : [];
  const refs: { name: string; buffer: Buffer }[] = [];
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i] as { arrayBuffer?: () => Promise<ArrayBuffer>; name?: string };
    if (f && typeof f.arrayBuffer === "function") {
      refs.push({ name: f.name ?? `ref${i}.png`, buffer: Buffer.from(await f.arrayBuffer()) });
    }
  }
  return refs;
}

/** Build a Codex prompt + image list from OpenAI chat.completions messages. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFromChatMessages(messages: any[], jsonMode: boolean): { prompt: string; images: { dataUrl?: string }[] } {
  const texts: string[] = [];
  const images: { dataUrl?: string }[] = [];
  for (const m of messages ?? []) {
    if (typeof m?.content === "string") texts.push(m.content);
    else if (Array.isArray(m?.content)) {
      for (const part of m.content) {
        if (part?.type === "text" && part.text) texts.push(part.text);
        else if (part?.type === "image_url" && part.image_url?.url) images.push({ dataUrl: part.image_url.url });
      }
    }
  }
  let prompt = texts.join("\n\n");
  if (jsonMode) prompt += "\n\nReturn ONLY a single valid JSON object — no prose, no markdown fences, nothing outside the JSON.";
  return { prompt, images };
}

/** Build a Codex prompt + image list from OpenAI Responses API input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFromResponsesInput(input: any[], instructions?: string): { prompt: string; images: { dataUrl?: string }[] } {
  const texts: string[] = [];
  const images: { dataUrl?: string }[] = [];
  for (const item of input ?? []) {
    if (typeof item?.content === "string") texts.push(item.content);
    else if (Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (part?.type === "input_text" && part.text) texts.push(part.text);
        else if (part?.type === "input_image" && part.image_url) images.push({ dataUrl: part.image_url });
      }
    }
  }
  let prompt = texts.join("\n\n");
  if (instructions) prompt += "\n\n" + instructions;
  return { prompt, images };
}

/**
 * The Codex client. Images run on Codex's built-in image tool; text + vision
 * (chat.completions + responses) run on Codex via codexText. It needs NO OpenAI
 * key — the whole local path is Codex. (CODEX_STUB=1 stubs only the images.)
 * web_search isn't a Codex tool, so Agent 2's call simply omits it (Codex uses
 * its own knowledge).
 */
function makeCodexClient(): OpenAI {
  const useStub = process.env.CODEX_STUB === "1";

  const codexImages = {
    async edit(args: { image?: unknown; prompt?: string; size?: string }) {
      if (useStub) return { data: [{ b64_json: PLACEHOLDER_PNG_BASE64 }] };
      const { codexImage } = await import("./codex-image");
      const references = await filesToRefs(args.image);
      const b64 = await codexImage({ prompt: args.prompt ?? "", references, size: args.size });
      return { data: [{ b64_json: b64 }] };
    },
    async generate(args: { prompt?: string; size?: string }) {
      if (useStub) return { data: [{ b64_json: PLACEHOLDER_PNG_BASE64 }] };
      const { codexImage } = await import("./codex-image");
      const b64 = await codexImage({ prompt: args.prompt ?? "", size: args.size });
      return { data: [{ b64_json: b64 }] };
    },
  };

  const codexChat = {
    completions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async create(params: any) {
        const jsonMode = params?.response_format?.type === "json_object";
        const { prompt, images } = buildFromChatMessages(params?.messages ?? [], jsonMode);
        const { codexText, stripJsonFences } = await import("./codex-text");
        let text = await codexText({ prompt, images });
        if (jsonMode) text = stripJsonFences(text);
        return { choices: [{ message: { role: "assistant", content: text } }], usage: undefined };
      },
    },
  };

  const codexResponses = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async create(params: any) {
      const { prompt, images } = buildFromResponsesInput(params?.input ?? [], params?.instructions);
      const { codexText, stripJsonFences } = await import("./codex-text");
      const text = stripJsonFences(await codexText({ prompt, images }));
      return { output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: undefined };
    },
  };

  return new Proxy({} as OpenAI, {
    get(_target, prop) {
      if (prop === "images") return codexImages;
      if (prop === "chat") return codexChat;
      if (prop === "responses") return codexResponses;
      return undefined;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as OpenAI;
}

let cached: OpenAI | null = null;

/** Returns the model client selected by MODEL_ENGINE (cached per process). */
export async function getModelClient(): Promise<OpenAI> {
  if (cached) return cached;
  if (getModelEngineKind() === "codex") {
    cached = makeCodexClient();
    console.log(
      `[model-client] engine: codex (${process.env.CODEX_STUB === "1" ? "STUB images" : "real Codex images"}, text+vision via Codex — no OpenAI key needed)`,
    );
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
