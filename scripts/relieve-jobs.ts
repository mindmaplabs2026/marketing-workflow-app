/**
 * Mark orphaned work (non-terminal but no live worker) as failed so the frontend
 * stops spinning. Covers BOTH generation jobs (ai_generation_jobs) and chat-edits
 * (ai_chat_messages). A non-terminal row older than STALE_MIN cannot be in-flight
 * (the worker processes one at a time and these are hours old).
 *
 * Dry-run (default, READ-ONLY):
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/relieve-jobs.ts
 * Apply:
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/relieve-jobs.ts --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";

const STALE_MIN = 30;
const APPLY = process.argv.includes("--apply");
const REASON = "Orphaned (worker lost connection / restarted mid-job); marked failed by relieve-jobs.";

type Table = {
  table: "ai_generation_jobs" | "ai_chat_messages";
  label: string;
  terminal: string[];
  refCol: string;
  extraUpdate?: Record<string, unknown>;
};

const TABLES: Table[] = [
  { table: "ai_generation_jobs", label: "generation job", terminal: ["completed", "failed"], refCol: "request_id", extraUpdate: { error_message: REASON } },
  { table: "ai_chat_messages", label: "chat-edit", terminal: ["done", "failed"], refCol: "variation_id" },
];

async function relieve(admin: ReturnType<typeof createAdminClient>, t: Table) {
  const { data, error } = await admin
    .from(t.table)
    .select(`id, status, created_at, ${t.refCol}`)
    .not("status", "in", `(${t.terminal.join(",")})`)
    .order("created_at", { ascending: false });
  if (error) { console.error(`${t.table} query failed:`, error.message); return; }

  const now = Date.now();
  const orphaned = (data ?? []).filter(
    (r) => (now - new Date((r as unknown as Record<string, unknown>).created_at as string).getTime()) / 60000 > STALE_MIN,
  );

  if (orphaned.length === 0) { console.log(`${t.label}: none orphaned.`); return; }

  console.log(`${t.label}: ${APPLY ? "failing" : "[dry-run] would fail"} ${orphaned.length}:`);
  for (const r of orphaned as unknown as Record<string, unknown>[]) {
    const ageMin = Math.round((now - new Date(r.created_at as string).getTime()) / 60000);
    console.log(`  ${r.id}  was=${r.status}  age=${ageMin}m  ${t.refCol}=${r[t.refCol]}`);
  }
  if (!APPLY) return;

  for (const r of orphaned as unknown as Record<string, unknown>[]) {
    const { error: upErr } = await admin
      .from(t.table)
      .update({ status: "failed", ...(t.extraUpdate ?? {}) })
      .eq("id", r.id as string)
      .not("status", "in", `(${t.terminal.join(",")})`); // don't clobber one that just finished
    console.log(upErr ? `  ✗ ${r.id}: ${upErr.message}` : `  ✓ ${r.id} → failed`);
  }
}

async function main() {
  const admin = createAdminClient();
  for (const t of TABLES) await relieve(admin, t);
  if (!APPLY) console.log("\nRe-run with --apply to mark these failed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
