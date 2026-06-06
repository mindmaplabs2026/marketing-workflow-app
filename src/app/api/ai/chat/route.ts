import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI } from "@/lib/ai/openai-client";

const MAX_CHAT_ROUNDS = 25;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json();
  const { variation_id, message } = body as {
    variation_id?: string;
    message?: string;
  };

  if (!variation_id || !message?.trim()) {
    return NextResponse.json(
      { error: "variation_id and message are required." },
      { status: 400 },
    );
  }

  // Load the variation and verify ownership
  const { data: variation, error: varErr } = await supabase
    .from("ai_variations")
    .select(
      "id, request_id, variation_index, creative_brief, storage_paths, chat_rounds_used",
    )
    .eq("id", variation_id)
    .single();

  if (varErr || !variation) {
    return NextResponse.json(
      { error: "Variation not found." },
      { status: 404 },
    );
  }

  // Check the user is the assigned designer or super_admin
  const { data: req } = await supabase
    .from("requests")
    .select("assigned_designer_id")
    .eq("id", variation.request_id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const isAssignedDesigner = req?.assigned_designer_id === user.id;
  const isSuperAdmin = profile?.role === "super_admin";

  if (!isAssignedDesigner && !isSuperAdmin) {
    return NextResponse.json(
      { error: "Only the assigned designer can chat." },
      { status: 403 },
    );
  }

  if (variation.chat_rounds_used >= MAX_CHAT_ROUNDS) {
    return NextResponse.json(
      { error: "Maximum chat rounds reached (25/25)." },
      { status: 429 },
    );
  }

  // Load conversation history
  const { data: history } = await supabase
    .from("ai_chat_messages")
    .select("role, content, image_paths")
    .eq("variation_id", variation_id)
    .order("created_at", { ascending: true });

  // Load the AI job context for the system prompt
  const { data: job } = await supabase
    .from("ai_generation_jobs")
    .select("agent1_output, agent2_output")
    .eq("request_id", variation.request_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Build the system prompt with full pipeline context
  const brief = variation.creative_brief as Record<string, unknown>;
  const systemPrompt = `You are a poster design editing assistant. You help refine Instagram posters based on user feedback.

## Context from Understanding Agent
${job?.agent1_output ? JSON.stringify(job.agent1_output, null, 2).slice(0, 2000) : "N/A"}

## Creative Brief for This Variation (Variation ${variation.variation_index})
${JSON.stringify(brief, null, 2).slice(0, 3000)}

## Current Poster
The current poster has ${variation.storage_paths.length} page(s).

## Instructions
The user will describe edits they want. Respond briefly confirming what you'll change, then generate a revised poster. Keep the same creative direction and overall theme — only modify what the user asks for.`;

  // Build messages for the OpenAI API
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];

  // Add conversation history
  for (const msg of history ?? []) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  // Add the new user message
  messages.push({ role: "user", content: message.trim() });

  const openai = getOpenAI();

  try {
    // Step 1: Get the text response / edit plan
    const chatResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 500,
    });

    const assistantText =
      chatResponse.choices[0]?.message?.content ?? "Applying your edits...";

    // Step 2: Generate the updated poster
    const editPrompt = `${(brief as { designPrompt?: string }).designPrompt ?? ""}\n\nUser edit request: ${message.trim()}\n\nAssistant plan: ${assistantText}`;

    const imageResponse = await openai.images.generate({
      model: "gpt-image-2",
      prompt: editPrompt,
      n: 1,
      size: "1024x1024",
      quality: "high",
    });

    const imageItem = imageResponse.data?.[0];
    if (!imageItem) {
      throw new Error("No image returned from generation.");
    }
    const imageUrl = imageItem.b64_json
      ? `data:image/png;base64,${imageItem.b64_json}`
      : imageItem.url;
    if (!imageUrl) {
      throw new Error("No image url or b64_json returned.");
    }

    // Download and upload to Supabase
    const admin = createAdminClient();
    const round = variation.chat_rounds_used + 1;

    // Get school_id from request for storage path
    const { data: fullReq } = await admin
      .from("requests")
      .select("school_id")
      .eq("id", variation.request_id)
      .single();
    const schoolId = fullReq?.school_id ?? "unknown";

    const timestamp = Date.now();
    const storagePath = `${schoolId}/${variation.request_id}/ai/${variation.variation_index}/edits/${round}-${timestamp}.png`;

    let imageBuffer: Buffer;
    if (imageUrl.startsWith("data:")) {
      const base64 = imageUrl.split(",")[1];
      imageBuffer = Buffer.from(base64, "base64");
    } else {
      const res = await fetch(imageUrl);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    }

    await admin.storage.from("designs").upload(storagePath, imageBuffer, {
      contentType: "image/png",
      upsert: false,
    });

    // Store user message
    await admin.from("ai_chat_messages").insert({
      variation_id,
      role: "user",
      content: message.trim(),
    });

    // Store assistant message with new image
    await admin.from("ai_chat_messages").insert({
      variation_id,
      role: "assistant",
      content: assistantText,
      image_paths: [storagePath],
      metadata: {
        model: "gpt-image-2",
        chat_model: "gpt-4o-mini",
        round,
      },
    });

    // Update variation: increment rounds used, update storage paths with latest
    const newStoragePaths = [...variation.storage_paths];
    // Replace with the edited version (for single poster, replace the first;
    // for carousel, replace all with the latest set — simplified for now)
    if (newStoragePaths.length === 1) {
      newStoragePaths[0] = storagePath;
    } else {
      // For carousel, append the edit to the set
      newStoragePaths.push(storagePath);
    }

    await admin
      .from("ai_variations")
      .update({
        chat_rounds_used: round,
        storage_paths: newStoragePaths,
      })
      .eq("id", variation_id);

    // Get signed URL for the new image
    const { data: signedData } = await admin.storage
      .from("designs")
      .createSignedUrl(storagePath, 300);

    return NextResponse.json({
      message: assistantText,
      imagePaths: [storagePath],
      imageUrl: signedData?.signedUrl ?? null,
      roundsRemaining: MAX_CHAT_ROUNDS - round,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Chat edit failed.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
