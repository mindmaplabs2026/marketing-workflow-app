/**
 * Codex Poster Bridge — model-engine abstraction.
 *
 * This is the single seam that lets the 5 agents talk to EITHER the OpenAI SDK
 * (today) OR Codex-on-subscription (later) without changing agent logic.
 *
 * The four capabilities mirror exactly what the agents need today:
 *   think()         → text/vision reasoning (chat.completions), optional JSON mode
 *   research()      → text/vision reasoning WITH web search (responses API)
 *   editImage()     → render a poster from a prompt + reference images (images.edit)
 *   generateImage() → render a poster from a prompt only (images.generate)
 */

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "high" | "medium" | "low";
export type ImageDetail = "high" | "low";

/** A single piece of user content: either text or an inline image (data URL). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string; detail?: ImageDetail };

export interface ThinkParams {
  system: string;
  user: ContentPart[];
  /** Force the model to return a single valid JSON object. */
  jsonMode?: boolean;
  maxTokens?: number;
  /** Short label used by the caller for cost tracking / logging. */
  label: string;
}

export interface ResearchParams {
  system?: string;
  user: ContentPart[];
  /** Final instruction appended after research (e.g. "return ONLY valid JSON"). */
  instructions: string;
  searchContextSize?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  label: string;
}

export interface ImageEditParams {
  prompt: string;
  references: { name: string; buffer: Buffer }[];
  size: ImageSize;
  quality: ImageQuality;
  label: string;
}

export interface ImageGenerateParams {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  label: string;
}

/** Token usage, passed straight through to the existing CostTracker. */
export type Usage = unknown;

export interface ThinkResult {
  text: string;
  usage?: Usage;
}

export interface ImageResult {
  /** Base64-encoded PNG (no data-URL prefix). */
  base64: string;
}

export interface ModelEngine {
  readonly kind: ModelEngineName;
  think(params: ThinkParams): Promise<ThinkResult>;
  research(params: ResearchParams): Promise<ThinkResult>;
  editImage(params: ImageEditParams): Promise<ImageResult>;
  generateImage(params: ImageGenerateParams): Promise<ImageResult>;
}

export type ModelEngineName = "openai" | "codex";
