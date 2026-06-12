/**
 * Phase 5a test — drive Codex's built-in image tool from Node via codexImage().
 *   npx tsx scripts/codex-image-test.ts
 * Saves codex-gen-test.png so we can eyeball the result.
 */
import { promises as fs } from "node:fs";
import { codexImage } from "../src/lib/ai/codex-image";

async function main() {
  console.log("[codex-image-test] generating a poster via Codex (subscription)…");
  const t0 = Date.now();
  const b64 = await codexImage({
    prompt:
      "A vibrant Instagram poster for a school 'Annual Sports Day 2026'. Bold modern headline, energetic athletic imagery, clean layout, bright cohesive colors.",
    size: "1024x1536",
  });
  await fs.writeFile("codex-gen-test.png", Buffer.from(b64, "base64"));
  console.log(`[codex-image-test] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — saved codex-gen-test.png (${b64.length} b64 chars)`);
}

main().catch((e) => {
  console.error("[codex-image-test] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
