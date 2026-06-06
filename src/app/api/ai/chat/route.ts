import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "@/lib/inngest/client";

const MAX_CHAT_ROUNDS = 25;

/**
 * POST /api/ai/chat
 * Validates the request, stores the user message, fires an Inngest event
 * for async processing, and returns immediately.
 *
 * GET /api/ai/chat?message_id=xxx
 * Polls for the assistant's response to a specific user message.
 */

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

  const { data: variation, error: varErr } = await supabase
    .from("ai_variations")
    .select("id, request_id, variation_index, chat_rounds_used")
    .eq("id", variation_id)
    .single();

  if (varErr || !variation) {
    return NextResponse.json({ error: "Variation not found." }, { status: 404 });
  }

  // Check permissions
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
    return NextResponse.json({ error: "Only the assigned designer can chat." }, { status: 403 });
  }

  if (variation.chat_rounds_used >= MAX_CHAT_ROUNDS) {
    return NextResponse.json({ error: "Maximum chat rounds reached (25/25)." }, { status: 429 });
  }

  // Store the user message immediately
  const admin = createAdminClient();
  const { data: userMsg, error: insertErr } = await admin
    .from("ai_chat_messages")
    .insert({
      variation_id,
      role: "user" as const,
      content: message.trim(),
    })
    .select("id")
    .single();

  if (insertErr || !userMsg) {
    return NextResponse.json({ error: "Could not store message." }, { status: 500 });
  }

  // Fire Inngest event for async processing
  await inngest.send({
    name: "ai/chat.edit",
    data: {
      userMessageId: userMsg.id,
      variationId: variation_id,
      requestId: variation.request_id,
      message: message.trim(),
    },
  });

  // Return immediately with the user message ID for polling
  return NextResponse.json({
    status: "processing",
    userMessageId: userMsg.id,
    roundsRemaining: MAX_CHAT_ROUNDS - variation.chat_rounds_used - 1,
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const userMessageId = url.searchParams.get("message_id");

  if (!userMessageId) {
    return NextResponse.json({ error: "message_id required." }, { status: 400 });
  }

  // Find the assistant response that came after this user message
  // by looking for the next message in the same variation
  const { data: userMsg } = await supabase
    .from("ai_chat_messages")
    .select("variation_id, created_at")
    .eq("id", userMessageId)
    .single();

  if (!userMsg) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  const { data: assistantMsg } = await supabase
    .from("ai_chat_messages")
    .select("id, content, image_paths, created_at")
    .eq("variation_id", userMsg.variation_id)
    .eq("role", "assistant")
    .gt("created_at", userMsg.created_at)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (!assistantMsg) {
    // Not ready yet
    return NextResponse.json({ status: "processing" });
  }

  // Get signed URLs for images
  let imageUrl: string | null = null;
  if (assistantMsg.image_paths.length > 0) {
    const { data: signedData } = await supabase.storage
      .from("designs")
      .createSignedUrl(assistantMsg.image_paths[0], 600);
    imageUrl = signedData?.signedUrl ?? null;
  }

  return NextResponse.json({
    status: "complete",
    message: assistantMsg.content,
    imageUrl,
    imagePaths: assistantMsg.image_paths,
  });
}
