import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set.");
  }
  client = new OpenAI({ apiKey });
  return client;
}

/**
 * Retry wrapper for OpenAI API calls that handles 429 rate limit errors.
 * Waits the recommended time (from Retry-After header or exponential backoff)
 * then retries up to `maxRetries` times.
 */
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof OpenAI.RateLimitError ||
        (err instanceof Error && err.message.includes("429"));
      if (!isRateLimit || attempt === maxRetries) throw err;

      // Parse Retry-After if available, otherwise use exponential backoff
      let waitMs = (attempt + 1) * 15_000; // 15s, 30s, 45s
      if (err instanceof OpenAI.RateLimitError) {
        const retryAfter = (err as unknown as { headers?: { "retry-after"?: string } }).headers?.["retry-after"];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) waitMs = parsed * 1000;
        }
      }
      console.warn(`OpenAI rate limit hit, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}
