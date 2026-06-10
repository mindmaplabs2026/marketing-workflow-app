/**
 * Phase 4 dry-run harness — proves the WHOLE journey on the stub, end to end,
 * using throwaway test data that is deleted afterwards.
 *
 *   1. create a [DRY-RUN] test school + request + queued job
 *   2. wait for the (separately running) worker to process it
 *   3. print the job status + the ai_variations it produced
 *   4. delete everything (request delete cascades job + variations) + storage
 *
 * Run the worker first in another terminal in STUB mode (no image cost):
 *   $env:POSTER_ENGINE='server'; $env:MODEL_ENGINE='codex'; npm run worker
 * Then run this:
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/dryrun.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("[dry-run] creating throwaway test data…");

  const { data: school, error: schoolErr } = await admin
    .from("schools")
    .insert({ name: "[DRY-RUN] Test School" })
    .select("id")
    .single();
  if (schoolErr || !school) throw new Error("create school: " + schoolErr?.message);

  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("id")
    .limit(1)
    .single();
  if (profErr || !prof) throw new Error("need at least one profile row: " + profErr?.message);

  const { data: req, error: reqErr } = await admin
    .from("requests")
    .insert({
      school_id: school.id,
      created_by: prof.id,
      title: "[DRY-RUN] Annual Sports Day Poster",
      description: "Celebrate our athletes at the annual sports day.",
      status: "in_design",
    })
    .select("id")
    .single();
  if (reqErr || !req) throw new Error("create request: " + reqErr?.message);

  const { data: job, error: jobErr } = await admin
    .from("ai_generation_jobs")
    .insert({ request_id: req.id, poster_type: "single" })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error("create job: " + jobErr?.message);

  console.log(`[dry-run] job ${job.id} queued. Waiting for worker…`);

  let status = "queued";
  let errorMessage: string | null = null;
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const { data: j } = await admin
      .from("ai_generation_jobs")
      .select("status, error_message")
      .eq("id", job.id)
      .single();
    if (j && j.status !== status) console.log(`[dry-run]   status → ${j.status}`);
    status = j?.status ?? status;
    errorMessage = j?.error_message ?? null;
    if (status === "completed" || status === "failed") break;
  }

  const { data: vars } = await admin
    .from("ai_variations")
    .select("id, storage_paths, poster_type")
    .eq("job_id", job.id);

  console.log("\n========== DRY-RUN RESULT ==========");
  console.log("final job status:", status);
  if (errorMessage) console.log("error_message:", errorMessage);
  console.log("variations produced:", vars?.length ?? 0);
  for (const v of vars ?? []) {
    console.log(`  - variation ${v.id}: ${v.storage_paths?.length ?? 0} page(s) → ${JSON.stringify(v.storage_paths)}`);
  }
  console.log("====================================\n");

  // ---- cleanup ----
  console.log("[dry-run] cleaning up test data…");
  const allPaths = (vars ?? []).flatMap((v) => v.storage_paths ?? []);
  if (allPaths.length > 0) {
    const { error: rmErr } = await admin.storage.from("designs").remove(allPaths);
    if (rmErr) console.warn("  storage cleanup warning:", rmErr.message);
  }
  await admin.from("requests").delete().eq("id", req.id); // cascades job + variations
  await admin.from("schools").delete().eq("id", school.id);
  console.log("[dry-run] cleanup done.");

  process.exit(status === "completed" ? 0 : 1);
}

main().catch((e) => {
  console.error("[dry-run] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
