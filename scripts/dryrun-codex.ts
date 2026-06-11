/**
 * Phase 5c — full-pipeline fidelity test with REAL Codex.
 * Throwaway test school + a real logo attached + a queued job → worker runs all
 * 5 agents on real Codex → downloads the produced poster locally for inspection,
 * then cleans up.
 *
 * Run the worker first with REAL codex (no CODEX_STUB):
 *   $env:POSTER_ENGINE='server'; $env:MODEL_ENGINE='codex'; npm run worker
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/dryrun-codex.ts
 */
import { promises as fs } from "node:fs";
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Find a real logo to attach (so Agent 2 selects it and Agent 3 edits with it).
  const { data: logos } = await admin
    .from("school_brand_assets").select("storage_path, uploaded_by").eq("asset_type", "logo").limit(1);
  const logo = logos?.[0];
  if (!logo) { console.error("no logo asset found"); process.exit(2); }

  const { data: school } = await admin.from("schools").insert({ name: "[DRY-RUN] Codex Fidelity School" }).select("id").single();
  const { data: prof } = await admin.from("profiles").select("id").limit(1).single();

  // Attach the real logo to the test school.
  await admin.from("school_brand_assets").insert({
    school_id: school!.id, asset_type: "logo", storage_path: logo.storage_path,
    uploaded_by: logo.uploaded_by ?? prof!.id, mime_type: "image/png",
  });

  const { data: req } = await admin.from("requests").insert({
    school_id: school!.id, created_by: prof!.id,
    title: "[DRY-RUN] Annual Day", description: "Annual day celebration with the school logo on top.",
    status: "in_design",
  }).select("id").single();
  const { data: job } = await admin.from("ai_generation_jobs").insert({ request_id: req!.id, poster_type: "single" }).select("id").single();

  console.log(`[codex-pipeline] job ${job!.id} queued — waiting for the worker (real Codex, ~3-5 min)…`);
  let status = "queued"; let err: string | null = null;
  for (let i = 0; i < 160; i++) {
    await sleep(4000);
    const { data: j } = await admin.from("ai_generation_jobs").select("status, error_message").eq("id", job!.id).single();
    if (j && j.status !== status) console.log(`[codex-pipeline]   status → ${j.status}`);
    status = j?.status ?? status; err = j?.error_message ?? null;
    if (status === "completed" || status === "failed") break;
  }

  const { data: variation } = await admin.from("ai_variations").select("storage_paths").eq("job_id", job!.id).single();
  const paths = variation?.storage_paths ?? [];
  console.log("\n========== CODEX PIPELINE RESULT ==========");
  console.log("status:", status, err ? `(${err})` : "");
  console.log("poster pages:", paths.length);

  // Download the produced poster locally for visual inspection.
  if (paths.length > 0) {
    const { data: blob } = await admin.storage.from("designs").download(paths[0]);
    if (blob) {
      await fs.writeFile("codex-pipeline-test.png", Buffer.from(await blob.arrayBuffer()));
      console.log("saved codex-pipeline-test.png ← inspect this");
    }
  }
  console.log("===========================================\n");

  // cleanup (do NOT touch the real logo storage object — only the generated posters)
  console.log("[codex-pipeline] cleaning up…");
  if (paths.length > 0) await admin.storage.from("designs").remove(paths);
  await admin.from("requests").delete().eq("id", req!.id);  // cascades job + variation
  await admin.from("school_brand_assets").delete().eq("school_id", school!.id);
  await admin.from("schools").delete().eq("id", school!.id);
  console.log("[codex-pipeline] cleanup done.");

  process.exit(status === "completed" && paths.length > 0 ? 0 : 1);
}

main().catch((e) => { console.error("[codex-pipeline] FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
