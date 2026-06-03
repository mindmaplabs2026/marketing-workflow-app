#!/usr/bin/env node
// One-time migration: move every storage object from the flat
//   <request_id>/<file>
// layout into the school-grouped
//   <school_id>/<request_id>/<file>
// layout, and update the storage_path column in request_uploads / designs.
//
// Run from project root AFTER deploying migration 0018:
//   node --env-file=.env.local scripts/backfill-storage-paths.mjs
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Idempotent: rows whose storage_path already starts with their school_id
// are skipped, so safe to re-run.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function backfill(table, bucket) {
  console.log(`\n=== ${table}  (bucket: ${bucket}) ===`);

  const { data: rows, error } = await supabase
    .from(table)
    .select("id, request_id, storage_path");
  if (error) throw error;
  if (!rows || rows.length === 0) {
    console.log("  no rows.");
    return;
  }

  const reqIds = [...new Set(rows.map((r) => r.request_id))];
  const { data: requests, error: reqErr } = await supabase
    .from("requests")
    .select("id, school_id")
    .in("id", reqIds);
  if (reqErr) throw reqErr;
  const schoolByReq = new Map(requests.map((r) => [r.id, r.school_id]));

  let moved = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const schoolId = schoolByReq.get(row.request_id);
    if (!schoolId) {
      console.warn(`  skip ${row.id}: parent request not found`);
      failed++;
      continue;
    }
    if (row.storage_path.startsWith(`${schoolId}/`)) {
      skipped++;
      continue;
    }

    const newPath = `${schoolId}/${row.storage_path}`;

    const { error: moveErr } = await supabase.storage
      .from(bucket)
      .move(row.storage_path, newPath);
    if (moveErr) {
      console.warn(
        `  move failed: ${row.storage_path} -> ${newPath}  (${moveErr.message})`,
      );
      failed++;
      continue;
    }

    const { error: updErr } = await supabase
      .from(table)
      .update({ storage_path: newPath })
      .eq("id", row.id);
    if (updErr) {
      console.warn(`  DB update failed for ${row.id}: ${updErr.message}`);
      failed++;
      continue;
    }

    moved++;
    console.log(`  moved ${row.storage_path} -> ${newPath}`);
  }

  console.log(`  Done: moved=${moved}  skipped=${skipped}  failed=${failed}`);
}

await backfill("request_uploads", "request-uploads");
await backfill("designs", "designs");

console.log("\nBackfill complete.");
