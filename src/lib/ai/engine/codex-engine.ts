/**
 * Codex implementation of ModelEngine.
 *
 * ⚠️ STUB STAGE (Phase 1–4): the real Codex calls are wired in Phase 5, once a
 * ChatGPT subscription + always-on server are available. Until then:
 *   - think()/research() delegate to a text backend (the OpenAI engine) so the
 *     pipeline produces VALID agent JSON and the whole flow can be tested.
 *   - editImage()/generateImage() return a tiny placeholder PNG instead of
 *     calling any paid image API — so the full journey (server worker → review
 *     UI → approval) can be dry-run for free.
 *
 * Phase 5 replaces the bodies of these four methods with real Codex CLI calls
 * (built-in gpt-image-2 image generation on the subscription). Nothing outside
 * this file changes when that swap happens — that is the whole point of the seam.
 */
import type {
  ImageEditParams,
  ImageGenerateParams,
  ImageResult,
  ModelEngine,
  ResearchParams,
  ThinkParams,
  ThinkResult,
} from "./types";

/** 1×1 PNG — a valid image so uploads/signed-URLs/preview all work in dry-run. */
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

export class CodexEngine implements ModelEngine {
  readonly kind = "codex" as const;

  /**
   * @param textBackend used for reasoning until real Codex text calls are wired
   *        in Phase 5. Pass the OpenAI engine here during the stub stage.
   */
  constructor(private readonly textBackend: ModelEngine) {}

  async think(p: ThinkParams): Promise<ThinkResult> {
    // TODO(Phase 5): replace with a real Codex reasoning call (no OpenAI key).
    return this.textBackend.think(p);
  }

  async research(p: ResearchParams): Promise<ThinkResult> {
    // TODO(Phase 5): replace with real Codex + web search (verify support).
    return this.textBackend.research(p);
  }

  async editImage(p: ImageEditParams): Promise<ImageResult> {
    // TODO(Phase 5): real Codex built-in gpt-image-2 edit with reference images.
    console.warn(
      `[codex-stub] editImage(${p.label}): ${p.references.length} refs → placeholder PNG (no real generation yet)`,
    );
    return { base64: PLACEHOLDER_PNG_BASE64 };
  }

  async generateImage(p: ImageGenerateParams): Promise<ImageResult> {
    // TODO(Phase 5): real Codex built-in gpt-image-2 generation.
    console.warn(
      `[codex-stub] generateImage(${p.label}) → placeholder PNG (no real generation yet)`,
    );
    return { base64: PLACEHOLDER_PNG_BASE64 };
  }
}
