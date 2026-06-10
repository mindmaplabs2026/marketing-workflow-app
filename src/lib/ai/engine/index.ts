/**
 * ⚠️ PARKED / NOT WIRED IN (as of Phase 2).
 * This semantic-engine approach was superseded by the lower-risk duck-typed
 * `src/lib/ai/model-client.ts`, which the agents actually use. These files are
 * kept as an alternative design and are intentionally not imported anywhere.
 * Decision to keep or remove is deferred to Phase 7 (cleanup). Do not wire this
 * in without revisiting model-client.ts first.
 *
 * Engine factory — returns the ModelEngine selected by MODEL_ENGINE.
 *
 * Default ("openai") returns the OpenAI engine, so existing behaviour is
 * unchanged. "codex" returns the Codex engine (currently a stub that uses the
 * OpenAI engine for text and placeholder images — see codex-engine.ts).
 *
 * Engines are dynamically imported so that simply importing this module does not
 * eagerly pull in `server-only` (via the OpenAI client) until an engine is built.
 */
import type { ModelEngine } from "./types";
import { getModelEngineKind } from "../../config/engine";

let cached: ModelEngine | null = null;

export async function getEngine(): Promise<ModelEngine> {
  if (cached) return cached;

  const kind = getModelEngineKind();
  const { OpenAIEngine } = await import("./openai-engine");
  const openai = new OpenAIEngine();

  if (kind === "codex") {
    const { CodexEngine } = await import("./codex-engine");
    cached = new CodexEngine(openai);
  } else {
    cached = openai;
  }

  console.log(`[engine] using model engine: ${cached.kind}`);
  return cached;
}

/** Test/worker helper: clear the cached engine (e.g. after changing env). */
export function resetEngineCache(): void {
  cached = null;
}

export type { ModelEngine } from "./types";
export * from "./types";
