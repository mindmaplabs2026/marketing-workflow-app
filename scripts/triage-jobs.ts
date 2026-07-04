/**
 * READ-ONLY triage: shows ai_generation_jobs that are not in a terminal state
 * (queued or stuck mid-pipeline), so we can see what's blocking the frontend.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/triage-jobs.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";

const TERMINAL = ["completed", "failed"];
const STALE_MIN = 30; // a non-terminal job older than this is almost certainly orphaned

async function main() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_generation_jobs")
    .select("id, request_id, poster_type, status, created_at, started_at, error_message")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) { console.error("query failed:", error.message); process.exit(1); }

  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log("Last 100 jobs by status:", byStatus);

  const now = Date.now();
  const stuck = rows.filter((r) => !TERMINAL.includes(r.status));
  console.log(`\nNon-terminal (queued / mid-pipeline) jobs: ${stuck.length}`);
  for (const r of stuck) {
    const ageMin = Math.round((now - new Date(r.created_at as string).getTime()) / 60000);
    const stale = ageMin > STALE_MIN ? "  ← STALE" : "";
    console.log(`  ${r.id}  ${r.poster_type}/${r.status}  age=${ageMin}m  req=${r.request_id}${stale}`);
  }
  console.log("\n(read-only — nothing was modified)");
}

main().catch((e) => { console.error(e); process.exit(1); });
