/**
 * Codex Poster Bridge — engine configuration.
 *
 * Two independent switches, both defaulting to the CURRENT behaviour so that
 * with no env changes the app runs exactly as it does today (safe rollback).
 *
 *  - POSTER_ENGINE: WHERE the 5-agent pipeline runs.
 *      "inngest" (default) → today's path: Inngest functions on Vercel.
 *      "server"            → our own always-on worker pulls jobs and runs them.
 *
 *  - MODEL_ENGINE: WHICH model backend the agents call.
 *      "openai" (default)  → OpenAI SDK (metered API key) — today's behaviour.
 *      "codex"             → Codex on a ChatGPT subscription (no per-image API cost).
 *
 * See project_codex_bridge.md for the full plan.
 */

export type PosterEngine = "inngest" | "server";
export type ModelEngineKind = "openai" | "codex";
export type PosterCompositionMode = "svg" | "schema";

/**
 * POSTER_COMPOSITION_MODE: HOW the V3 poster path builds each page.
 *   "svg" (default)  → today's path: a model writes freeform SVG chrome, then
 *                      real photos + logo/footer are composited on top.
 *   "schema"         → the model emits a structured PosterDoc; a fixed flow
 *                      renderer lays it out (no blind coordinates, no overlaps).
 * Defaults to "svg" so nothing changes until the flag is set (safe rollback).
 */
export function getPosterCompositionMode(): PosterCompositionMode {
  return process.env.POSTER_COMPOSITION_MODE === "schema" ? "schema" : "svg";
}

export function getPosterEngine(): PosterEngine {
  return process.env.POSTER_ENGINE === "server" ? "server" : "inngest";
}

export function getModelEngineKind(): ModelEngineKind {
  return process.env.MODEL_ENGINE === "codex" ? "codex" : "openai";
}

/** True when the pipeline should run on our own server worker (not Inngest/Vercel). */
export function isServerEngine(): boolean {
  return getPosterEngine() === "server";
}
