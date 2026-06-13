/**
 * Shared chat-edit logic (Codex Poster Bridge — Phase 3b).
 *
 * The "chat & edit" redesign ("make the logo bigger") is the same in both modes;
 * only WHO runs it differs. This function holds the logic so it can be called by:
 *   - the Inngest function aiChatEdit (POSTER_ENGINE=inngest, on Vercel), and
 *   - the standalone worker (POSTER_ENGINE=server).
 *
 * Image calls go through the model client, so MODEL_ENGINE controls whether the
 * edit uses OpenAI or Codex — identical to the generation path.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getModelClient } from "./model-client";
import { getModelEngineKind } from "../config/engine";
import { toFile } from "openai";

export type ChatEditInput = {
  variationId: string;
  message: string;
  pageIndex: number | null;
};

export async function runChatEdit({ variationId, message, pageIndex }: ChatEditInput): Promise<void> {
  const startTime = Date.now();
  console.log(`[chat-edit] ── START ── variation=${variationId}, message="${message.slice(0, 80)}${message.length > 80 ? "..." : ""}"`);

  const admin = createAdminClient();
  const openai = await getModelClient();

  const { data: variation } = await admin
    .from("ai_variations")
    .select("id, request_id, variation_index, storage_paths, poster_type, chat_rounds_used")
    .eq("id", variationId)
    .single();

  if (!variation) throw new Error("Variation not found");
  const requestId = variation.request_id;
  console.log(`[chat-edit] Variation v${variation.variation_index}, ${variation.poster_type}, ${variation.storage_paths.length} pages, round ${variation.chat_rounds_used + 1}/25`);

  // Determine which page to edit.
  // Single posters: always edit the latest version (last in storage_paths).
  // Carousel: edit the specific page the user selected.
  const isSingle = variation.poster_type === "single";
  let editIndex: number;
  if (isSingle) {
    editIndex = variation.storage_paths.length - 1;
  } else {
    editIndex = pageIndex ?? 0;
    if (editIndex >= variation.storage_paths.length) {
      editIndex = variation.storage_paths.length - 1;
    }
  }

  // Conversation history
  const { data: history } = await admin
    .from("ai_chat_messages")
    .select("role, content")
    .eq("variation_id", variationId)
    .order("created_at", { ascending: true });

  // Step 1: short text confirmation of what will change
  const pageNote = isSingle ? "" : ` The user is editing page ${editIndex + 1} of a ${variation.storage_paths.length}-page carousel.`;
  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are a poster design editing assistant. The user wants minor tweaks to an existing poster.${pageNote} Respond briefly confirming what you'll change. Do NOT list the full design — just confirm the specific edit. Keep it to 1-2 sentences.`,
    },
  ];
  for (const msg of history ?? []) {
    chatMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  console.log(`[chat-edit] Step 1: Getting text confirmation (${history?.length ?? 0} messages in history)`);
  const chatResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: chatMessages,
    max_tokens: 200,
  });
  const assistantText = chatResponse.choices[0]?.message?.content ?? "Applying your edit...";
  console.log(`[chat-edit] Step 1 done: "${assistantText}"`);

  // Step 2: download the page being edited
  const currentPath = variation.storage_paths[editIndex];
  if (!currentPath) throw new Error("No poster page to edit");

  console.log(`[chat-edit] Step 2: Downloading page ${editIndex + 1} — ${currentPath}`);
  const { data: imgData } = await admin.storage.from("designs").download(currentPath);
  if (!imgData) throw new Error("Could not download current poster");
  const currentImageBuffer = Buffer.from(await imgData.arrayBuffer());
  console.log(`[chat-edit] Step 2 done: Downloaded ${(currentImageBuffer.length / 1024).toFixed(0)} KB`);
  const file = await toFile(currentImageBuffer, "current-poster.png", { type: "image/png" });

  // Step 3: targeted image edit
  // Codex: use dedicated chat-edit agent (vision + image gen in one session).
  // OpenAI: use images.edit API (true inpainting).
  let base64Result: string;
  const isCodex = getModelEngineKind() === "codex";

  console.log(`[chat-edit] Step 3: Generating edited image (engine=${isCodex ? "codex" : "openai"})`);
  if (isCodex) {
    const { codexChatEdit } = await import("./codex-chat-edit");
    base64Result = await codexChatEdit({
      currentPoster: currentImageBuffer,
      editMessage: message,
      size: "1024x1536",
    });
  } else {
    const editPrompt = `This is an existing Instagram poster. Make ONLY this change: ${message}

Keep EVERYTHING else exactly the same — same layout, same images, same colors, same branding, same logo, same header, same footer. Only modify what was specifically requested. The poster dimensions are portrait 1080x1350px.`;

    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: [file],
      prompt: editPrompt,
      n: 1,
      size: "1024x1536",
      quality: "high",
    });

    const item = response.data?.[0];
    base64Result = item?.b64_json ?? "";
    if (!base64Result && item?.url) {
      base64Result = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  }
  if (!base64Result) throw new Error("Chat edit: no image returned");
  console.log(`[chat-edit] Step 3 done: Got edited image (${(base64Result.length / 1024).toFixed(0)} KB base64)`);

  // Step 4: upload the edited poster (do NOT replace the original)
  const { data: fullReq } = await admin
    .from("requests")
    .select("school_id")
    .eq("id", requestId)
    .single();
  const schoolId = fullReq?.school_id ?? "unknown";

  const round = variation.chat_rounds_used + 1;
  const timestamp = Date.now();
  const storagePath = `${schoolId}/${requestId}/ai/${variation.variation_index}/edits/${round}-${timestamp}.png`;
  const imageBuffer = Buffer.from(base64Result, "base64");
  console.log(`[chat-edit] Step 4: Uploading edited image → ${storagePath}`);
  await admin.storage.from("designs").upload(storagePath, imageBuffer, {
    contentType: "image/png",
    upsert: false,
  });

  // Store assistant message
  await admin.from("ai_chat_messages").insert({
    variation_id: variationId,
    role: "assistant",
    content: assistantText,
    image_paths: [storagePath],
    metadata: { model: "gpt-image-2", chat_model: "gpt-4o-mini", round },
  });

  // Update storage_paths: single → append; carousel → replace edited page in place
  let updatedPaths: string[];
  if (isSingle) {
    updatedPaths = [...variation.storage_paths, storagePath];
  } else {
    updatedPaths = [...variation.storage_paths];
    updatedPaths[editIndex] = storagePath;
  }

  await admin
    .from("ai_variations")
    .update({ chat_rounds_used: round, storage_paths: updatedPaths })
    .eq("id", variationId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[chat-edit] ── DONE ── round ${round}/25, ${isSingle ? "appended" : `replaced page ${editIndex + 1}`}, ${elapsed}s total`);
}
