import "server-only";

// OpenAI pricing (per 1M tokens) — updated June 2025
const PRICING = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  // gpt-image-2 pricing per image by size
  "gpt-image-2": {
    "1024x1024": 0.04,
    "1024x1536": 0.08,
    "1536x1024": 0.08,
    "auto": 0.08,
  },
} as const;

export type CostEntry = {
  stage: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  images?: number;
  image_size?: string;
  cost_usd: number;
};

export type CostTracking = {
  entries: CostEntry[];
  total_usd: number;
};

/**
 * Accumulates cost entries across pipeline stages.
 */
export class CostTracker {
  private entries: CostEntry[] = [];

  /**
   * Track a Chat Completions or Responses API call.
   */
  addLLMCall(
    stage: string,
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } | null | undefined,
  ): void {
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;

    const pricing = model.includes("4o-mini")
      ? PRICING["gpt-4o-mini"]
      : PRICING["gpt-4o"];

    const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

    this.entries.push({
      stage,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    });
  }

  /**
   * Track an image generation/edit call.
   */
  addImageCall(
    stage: string,
    imageCount: number,
    size: string = "1024x1536",
  ): void {
    const perImage = size === "1024x1024" ? 0.04 : 0.08;
    const cost = imageCount * perImage;

    this.entries.push({
      stage,
      model: "gpt-image-2",
      images: imageCount,
      image_size: size,
      cost_usd: cost,
    });
  }

  /**
   * Merge entries from another tracker (for combining across pipeline stages).
   */
  merge(other: CostTracking): void {
    this.entries.push(...other.entries);
  }

  /**
   * Get the final cost tracking object to store in DB.
   */
  toJSON(): CostTracking {
    const total = this.entries.reduce((sum, e) => sum + e.cost_usd, 0);
    return {
      entries: this.entries,
      total_usd: Math.round(total * 1_000_000) / 1_000_000,
    };
  }
}
