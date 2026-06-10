/**
 * Phase 3b dry-run — proves chat-edit runs on the worker, end to end, on the
 * stub, with throwaway data that is deleted afterwards.
 *
 *   1. create test school + request + queued job → wait for a variation
 *   2. insert a user chat message (status='queued') for that variation
 *   3. wait for the worker to process it (status='done' + assistant message)
 *   4. verify the variation gained an edited page
 *   5. delete everything (request delete cascades job/variation/messages) + storage
 *
 * Needs migration 0025 applied + the worker running in stub mode:
 *   $env:POSTER_ENGINE='server'; $env:MODEL_ENGINE='codex'; npm run worker
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/dryrun-chat.ts
 */
import { createAdminClient } from "@/lib/supabase/admin";

const admin = createAdminClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitJob(jobId: string): Promise<string> {
  let status = "queued";
  for (let i = 0; i < 80; i++) {
    await sleep(3000);
    const { data: j } = await admin.from("ai_generation_jobs").select("status").eq("id", jobId).single();
    status = j?.status ?? status;
    if (status === "completed" || status === "failed") break;
  }
  return status;
}

async function main() {
  // Pre-check: is migration 0025 applied?
  const probe = await admin.from("ai_chat_messages").select("status").limit(1);
  if (probe.error && /column .*status.* does not exist/i.test(probe.error.message)) {
    console.error("✗ Migration 0025 is not applied yet (ai_chat_messages.status missing). Apply it, then re-run.");
    process.exit(2);
  }

  console.log("[chat dry-run] creating test data + generating a base poster…");
  const { data: school } = await admin.from("schools").insert({ name: "[DRY-RUN] Chat Test School" }).select("id").single();
  const { data: prof } = await admin.from("profiles").select("id").limit(1).single();
  const { data: req } = await admin.from("requests").insert({
    school_id: school!.id, created_by: prof!.id,
    title: "[DRY-RUN] Chat Edit Poster", description: "Sports day.", status: "in_design",
  }).select("id").single();
  const { data: job } = await admin.from("ai_generation_jobs").insert({ request_id: req!.id, poster_type: "single" }).select("id").single();

  const jobStatus = await waitJob(job!.id);
  console.log(`[chat dry-run] base generation: ${jobStatus}`);

  const { data: variation } = await admin
    .from("ai_variations").select("id, storage_paths").eq("job_id", job!.id).single();
  if (!variation) throw new Error("no variation produced");
  const pagesBefore = variation.storage_paths.length;
  console.log(`[chat dry-run] variation ${variation.id} has ${pagesBefore} page(s). Sending chat edit…`);

  // Insert a queued chat-edit (what POST /api/ai/chat does in server mode)
  const { data: userMsg, error: msgErr } = await admin.from("ai_chat_messages").insert({
    variation_id: variation.id, role: "user" as const,
    content: "Make the logo bigger and brighten the colors.",
    page_index: null, status: "queued" as const,
  }).select("id").single();
  if (msgErr || !userMsg) throw new Error("insert chat message: " + msgErr?.message);

  // Wait for the worker to process the chat edit
  let msgStatus = "queued";
  let assistant: { content: string; image_paths: string[] } | null = null;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const { data: m } = await admin.from("ai_chat_messages").select("status").eq("id", userMsg.id).single();
    msgStatus = m?.status ?? msgStatus;
    if (msgStatus === "done" || msgStatus === "failed") break;
  }
  const { data: asst } = await admin
    .from("ai_chat_messages").select("content, image_paths")
    .eq("variation_id", variation.id).eq("role", "assistant")
    .order("created_at", { ascending: false }).limit(1).single();
  assistant = asst ?? null;

  const { data: after } = await admin.from("ai_variations").select("storage_paths, chat_rounds_used").eq("id", variation.id).single();
  const pagesAfter = after?.storage_paths.length ?? pagesBefore;

  console.log("\n========== CHAT DRY-RUN RESULT ==========");
  console.log("chat message status:", msgStatus);
  console.log("assistant replied:", assistant ? `yes — "${assistant.content.slice(0, 80)}"` : "no");
  console.log(`variation pages: ${pagesBefore} → ${pagesAfter}`, pagesAfter > pagesBefore ? "(edited page appended ✓)" : "");
  console.log("chat_rounds_used:", after?.chat_rounds_used);
  console.log("=========================================\n");

  // cleanup
  console.log("[chat dry-run] cleaning up…");
  const allPaths = after?.storage_paths ?? [];
  if (allPaths.length > 0) await admin.storage.from("designs").remove(allPaths);
  await admin.from("requests").delete().eq("id", req!.id);
  await admin.from("schools").delete().eq("id", school!.id);
  console.log("[chat dry-run] cleanup done.");

  const ok = msgStatus === "done" && !!assistant && pagesAfter > pagesBefore;
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[chat dry-run] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
