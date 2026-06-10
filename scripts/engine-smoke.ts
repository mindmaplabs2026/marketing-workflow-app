/**
 * Phase 1 smoke test — proves the model-engine seam + Codex stub work end to end
 * WITHOUT any OpenAI key or network. Run with:  npx tsx scripts/engine-smoke.ts
 *
 * It exercises the Codex stub's image methods (the part that needs no key) and
 * verifies the returned base64 is a real PNG. The text methods are covered later
 * in the full dry-run (Phase 4), where a real key is available.
 */
import { CodexEngine } from "../src/lib/ai/engine/codex-engine";
import type { ModelEngine } from "../src/lib/ai/engine/types";

// A dummy text backend so we can build the Codex engine without OpenAI.
const dummyText: ModelEngine = {
  kind: "openai",
  async think() {
    return { text: '{"ok":true}' };
  },
  async research() {
    return { text: '{"ok":true}' };
  },
  async editImage() {
    return { base64: "" };
  },
  async generateImage() {
    return { base64: "" };
  },
};

function isPng(base64: string): boolean {
  const buf = Buffer.from(base64, "base64");
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => buf[i] === b);
}

async function main() {
  const engine = new CodexEngine(dummyText);
  let pass = 0;
  let fail = 0;

  const check = (name: string, cond: boolean) => {
    if (cond) {
      pass++;
      console.log(`  ✓ ${name}`);
    } else {
      fail++;
      console.error(`  ✗ ${name}`);
    }
  };

  console.log("Phase 1 — engine smoke test");
  check("engine kind is codex", engine.kind === "codex");

  const edit = await engine.editImage({
    prompt: "test",
    references: [{ name: "logo.png", buffer: Buffer.from([1, 2, 3]) }],
    size: "1024x1536",
    quality: "high",
    label: "smoke_edit",
  });
  check("editImage returns a valid PNG", isPng(edit.base64));

  const gen = await engine.generateImage({
    prompt: "test",
    size: "1024x1536",
    quality: "high",
    label: "smoke_gen",
  });
  check("generateImage returns a valid PNG", isPng(gen.base64));

  const thought = await engine.think({
    system: "s",
    user: [{ type: "text", text: "hi" }],
    jsonMode: true,
    label: "smoke_think",
  });
  check("think() delegates to text backend", thought.text === '{"ok":true}');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
