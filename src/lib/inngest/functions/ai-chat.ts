import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI } from "@/lib/ai/openai-client";

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

    // Load job context
    const { data: job } = await admin
      .from("ai_generation_jobs")
      .select("agent1_output, agent2_output")
      .eq("request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Build system prompt
    const brief = variation.creative_brief as Record<string, unknown>;
    const systemPrompt = `You are a poster design editing assistant. You help refine Instagram posters based on user feedback.

## Creative Brief for This Variation
${JSON.stringify(brief, null, 2).slice(0, 3000)}

## Current Poster
The current poster has ${variation.storage_paths.length} page(s).

## Instructions
The user will describe edits they want. Respond briefly confirming what you'll change. Keep the same creative direction and overall theme — only modify what the user asks for.`;

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    for (const msg of history ?? []) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Step 1: Get text response
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 500,
    });

    const assistantText = chatResponse.choices[0]?.message?.content ?? "Applying your edits...";

    // Step 2: Generate updated poster
    const creativeVision = (brief as { creativeVision?: string }).creativeVision ?? "";
    const designPrompt = (brief as { designPrompt?: string }).designPrompt ?? "";
    const editPrompt = `${creativeVision || designPrompt}\n\nUser edit request: ${message}\n\nAssistant plan: ${assistantText}\n\nApply the user's requested changes while keeping the overall design, branding, and layout intact. Instagram poster, portrait 1080x1350px.`;

    // Download current poster as reference for the edit
    const currentPath = variation.storage_paths[variation.storage_paths.length - 1];
    let currentImageBuffer: Buffer | null = null;
    if (currentPath) {
      const { data: imgData } = await admin.storage.from("designs").download(currentPath);
      if (imgData) {
        currentImageBuffer = Buffer.from(await imgData.arrayBuffer());
      }
    }

    let base64Result: string;

    if (currentImageBuffer) {
      // Use images.edit with the current poster as reference
      const { toFile } = await import("openai");
      const file = await toFile(currentImageBuffer, "current-poster.png", { type: "image/png" });

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
    } else {
      const response = await openai.images.generate({
        model: "gpt-image-2",
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

    // Upload to storage
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

    // Update variation
    const newStoragePaths = [...variation.storage_paths];
    if (newStoragePaths.length === 1) {
      newStoragePaths[0] = storagePath;
    } else {
      newStoragePaths.push(storagePath);
    }

    await admin
      .from("ai_variations")
      .update({
        chat_rounds_used: round,
        storage_paths: newStoragePaths,
      })
      .eq("id", variationId);
  },
);
