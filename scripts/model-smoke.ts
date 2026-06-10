/**
 * Phase 2 smoke test — proves the swappable model client works with NO network.
 *   npx tsx scripts/model-smoke.ts
 *
 * A dummy key lets the real OpenAI client be CONSTRUCTED (no API call is made).
 * We only exercise the codex stub's image methods (placeholder, no network) and
 * confirm text surfaces pass through.
 */
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-dummy-for-smoke";

import { getModelClient, resetModelClientCache } from "../src/lib/ai/model-client";

function isPng(base64: string): boolean {
  const buf = Buffer.from(base64, "base64");
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => buf[i] === b);
}

async function main() {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.error(`  ✗ ${name}`); }
  };

  console.log("Phase 2 — model client smoke test");

  // --- codex (stub) ---
  process.env.MODEL_ENGINE = "codex";
  resetModelClientCache();
  const codex = await getModelClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edit = (await (codex.images as any).edit({ model: "gpt-image-2", prompt: "x", n: 1, size: "1024x1536", quality: "high" })) as { data: { b64_json: string }[] };
  check("codex: images.edit returns placeholder PNG", isPng(edit.data[0].b64_json));
  check("codex: chat surface passes through", typeof codex.chat?.completions?.create === "function");
  check("codex: responses surface passes through", typeof codex.responses?.create === "function");

  // --- openai (default) ---
  process.env.MODEL_ENGINE = "openai";
  resetModelClientCache();
  const oa = await getModelClient();
  check("openai: returns a real client with images.edit", typeof oa.images?.edit === "function");
  check("openai: returns a real client with chat.completions", typeof oa.chat?.completions?.create === "function");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
