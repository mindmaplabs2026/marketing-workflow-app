import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI } from "@/lib/ai/openai-client";
import { toFile } from "openai";

type ChatEditEvent = {
  name: "ai/chat.edit";
  data: {
    userMessageId: string;
    variationId: string;
    requestId: string;
    message: string;
  };
};

export const aiChatEdit = inngest.createFunction(
  {
    id: "ai-chat-edit",
    retries: 1,
    triggers: [{ event: "ai/chat.edit" }],
  },
  async ({ event }: { event: { data: ChatEditEvent["data"] } }) => {
    const { variationId, requestId, message } = event.data;
    const admin = createAdminClient();
    const openai = getOpenAI();

    // Load variation
    const { data: variation } = await admin
      .from("ai_variations")
      .select("id, variation_index, creative_brief, storage_paths, chat_rounds_used")
      .eq("id", variationId)
      .single();

    if (!variation) throw new Error("Variation not found");

    // Load conversation history
    const { data: history } = await admin
      .from("ai_chat_messages")
      .select("role, content")
      .eq("variation_id", variationId)
      .order("created_at", { ascending: true });

    // Step 1: Get the text response — what will be changed
    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: `You are a poster design editing assistant. The user wants minor tweaks to an existing poster. Respond briefly confirming what you'll change. Do NOT list the full design — just confirm the specific edit. Keep it to 1-2 sentences.`,
      },
    ];

    for (const msg of history ?? []) {
      chatMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: chatMessages,
      max_tokens: 200,
    });

    const assistantText = chatResponse.choices[0]?.message?.content ?? "Applying your edit...";

    // Step 2: Download the CURRENT poster — this is what we're editing
    // Always use the latest version (last in storage_paths)
    const currentPath = variation.storage_paths[variation.storage_paths.length - 1];
    if (!currentPath) throw new Error("No current poster to edit");

    const { data: imgData } = await admin.storage.from("designs").download(currentPath);
    if (!imgData) throw new Error("Could not download current poster");

    const currentImageBuffer = Buffer.from(await imgData.arrayBuffer());
    const file = await toFile(currentImageBuffer, "current-poster.png", { type: "image/png" });

    // Step 3: Use images.edit with a SHORT, targeted edit instruction
    // Do NOT re-describe the whole poster — just say what to change
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
    let base64Result = item?.b64_json ?? "";
    if (!base64Result && item?.url) {
      base64Result = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
    if (!base64Result) throw new Error("Chat edit: no image returned");

    // Step 4: Upload the edited poster (do NOT replace the original)
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
      metadata: {
        model: "gpt-image-2",
        chat_model: "gpt-4o-mini",
        round,
      },
    });

    // Update variation — APPEND the new path, do NOT replace the original.
    // storage_paths[0] always stays as the original Agent 3 output.
    // Edits are appended so the designer can see the progression.
    const updatedPaths = [...variation.storage_paths, storagePath];

    await admin
      .from("ai_variations")
      .update({
        chat_rounds_used: round,
        storage_paths: updatedPaths,
      })
      .eq("id", variationId);
  },
);
