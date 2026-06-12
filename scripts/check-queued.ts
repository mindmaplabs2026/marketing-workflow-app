/**
 * Read-only worker runtime check: confirms env + "@/" alias + server-only
 * neutralization + Supabase connectivity all work together. Counts queued
 * poster jobs. Does NOT claim or process anything.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/check-queued.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("ai_generation_jobs")
    .select("*", { count: "exact", head: true })
    .eq("status", "queued");
  if (error) {
    console.error("✗ Supabase query failed:", error.message);
    process.exit(1);
  }
  console.log(`✓ runtime OK — connected to Supabase. Queued poster jobs: ${count ?? 0}`);
}

main().catch((e) => {
  console.error("✗ failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
