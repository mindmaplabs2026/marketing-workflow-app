/**
 * Phase 5 fidelity test — does Codex's image EDIT copy a real brand asset
 * faithfully? Downloads one real logo/header, asks Codex to compose a poster
 * copying it exactly, and saves both for visual comparison.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/codex-edit-test.ts
 *
 * Outputs: ref-asset.png (the reference) and codex-edit-test.png (Codex output).
 */
import { promises as fs } from "node:fs";
import { createAdminClient } from "@/lib/supabase/admin";
import { codexImage } from "@/lib/ai/codex-image";

async function main() {
  const admin = createAdminClient();

  const { data: assets, error } = await admin
    .from("school_brand_assets")
    .select("asset_type, storage_path")
    .in("asset_type", ["logo", "header"])
    .limit(50);
  if (error) throw new Error(error.message);

  const asset =
    (assets ?? []).find((a) => a.asset_type === "logo") ??
    (assets ?? []).find((a) => a.asset_type === "header");
  if (!asset) {
    console.error("✗ No logo/header brand assets found in the DB to test against.");
    process.exit(2);
  }
  console.log(`[edit-test] using ${asset.asset_type}: ${asset.storage_path}`);

  const { data: blob, error: dlErr } = await admin.storage.from("school-assets").download(asset.storage_path);
  if (dlErr || !blob) throw new Error("download failed: " + dlErr?.message);
  const refBuf = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile("ref-asset.png", refBuf);
  console.log(`[edit-test] saved ref-asset.png (${refBuf.length} bytes). Asking Codex to copy it into a poster…`);

  const t0 = Date.now();
  const b64 = await codexImage({
    prompt:
      "Create a clean, professional Instagram poster for a school 'Annual Day' celebration. Place the provided school logo prominently at the TOP CENTER, reproduced EXACTLY as given (same shape, colors, and text — do not redraw or restyle it). Festive but elegant design below the logo with a headline 'ANNUAL DAY 2026'.",
    references: [{ name: "school-logo.png", buffer: refBuf }],
    size: "1024x1536",
  });
  await fs.writeFile("codex-edit-test.png", Buffer.from(b64, "base64"));
  console.log(`[edit-test] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — saved codex-edit-test.png. Compare it against ref-asset.png.`);
}

main().catch((e) => {
  console.error("[edit-test] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
