/**
 * OpenAI implementation of ModelEngine.
 *
 * This delegates to the existing OpenAI SDK calls so that, when MODEL_ENGINE
 * is "openai" (the default), the agents behave EXACTLY as they do today.
 * It is the reference behaviour the Codex engine must match.
 */
import { toFile } from "openai";
import type {
  ImageEditParams,
  ImageGenerateParams,
  ImageResult,
  ModelEngine,
  ResearchParams,
  ThinkParams,
  ThinkResult,
  ContentPart,
} from "./types";
import { getOpenAI, withRateLimitRetry } from "../openai-client";

function toChatContent(parts: ContentPart[]) {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text" as const, text: p.text }
      : {
          type: "image_url" as const,
          image_url: { url: p.dataUrl, detail: p.detail ?? "high" },
        },
  );
}

function toResponsesContent(parts: ContentPart[]) {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "input_text" as const, text: p.text }
      : {
          type: "input_image" as const,
          image_url: p.dataUrl,
          detail: p.detail ?? "high",
        },
  );
}

async function extractBase64(
  data: Array<{ b64_json?: string | null; url?: string | null }> | undefined,
): Promise<string> {
  const item = data?.[0];
  if (!item?.b64_json && !item?.url) {
    throw new Error("OpenAI image call returned no image");
  }
  if (item.b64_json) return item.b64_json;
  const res = await fetch(item.url as string);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

export class OpenAIEngine implements ModelEngine {
  readonly kind = "openai" as const;

  async think(p: ThinkParams): Promise<ThinkResult> {
    const openai = getOpenAI();
    const res = await withRateLimitRetry(() =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: p.system },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { role: "user", content: toChatContent(p.user) as any },
        ],
        ...(p.jsonMode
          ? { response_format: { type: "json_object" as const } }
          : {}),
        max_tokens: p.maxTokens ?? 1500,
      }),
    );
    return { text: res.choices[0]?.message?.content ?? "", usage: res.usage };
  }

  async research(p: ResearchParams): Promise<ThinkResult> {
    const openai = getOpenAI();
    const input: unknown[] = [];
    if (p.system) {
      input.push({
        role: "system",
        type: "message",
        content: [{ type: "input_text", text: p.system }],
      });
    }
    input.push({
      role: "user",
      type: "message",
      content: toResponsesContent(p.user),
    });
    const res = await withRateLimitRetry(() =>
      openai.responses.create({
        model: "gpt-4o-mini",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: input as any,
        tools: [
          {
            type: "web_search",
            search_context_size: p.searchContextSize ?? "medium",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ],
        instructions: p.instructions,
        max_output_tokens: p.maxOutputTokens ?? 12000,
      }),
    );
    let text = "";
    for (const item of res.output) {
      if (item.type === "message" && "content" in item && item.content) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const part of item.content as any[]) {
          if (part.type === "output_text") text += part.text;
        }
      }
    }
    return { text, usage: res.usage };
  }

  async editImage(p: ImageEditParams): Promise<ImageResult> {
    const openai = getOpenAI();
    const files = await Promise.all(
      p.references.map((r) => toFile(r.buffer, r.name, { type: "image/png" })),
    );
    const res = await withRateLimitRetry(() =>
      openai.images.edit({
        model: "gpt-image-2",
        image: files,
        prompt: p.prompt,
        n: 1,
        size: p.size,
        quality: p.quality,
      }),
    );
    return { base64: await extractBase64(res.data) };
  }

  async generateImage(p: ImageGenerateParams): Promise<ImageResult> {
    const openai = getOpenAI();
    const res = await withRateLimitRetry(() =>
      openai.images.generate({
        model: "gpt-image-2",
        prompt: p.prompt,
        n: 1,
        size: p.size,
        quality: p.quality,
      }),
    );
    return { base64: await extractBase64(res.data) };
  }
}
