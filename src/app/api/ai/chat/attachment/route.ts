import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/ai/chat/attachment  (application/json)
 * Body: { variation_id: string, content_type: string, size?: number }
 *
 * Issues a short-lived SIGNED UPLOAD URL for the `designs` bucket so the browser
 * can upload the reference/annotation image DIRECTLY to Supabase Storage — the
 * bytes never pass through this function. (Uploading via the function tripped
 * Vercel's ~4.5 MB request-body limit → an opaque 413 for larger images.)
 *
 * Returns { path, token }; the client uploads with storage.uploadToSignedUrl().
 * The chat POST then carries these paths in `attachment_paths`.
 */

// Matches the Supabase project's global file_size_limit (150 MB, paid plan) —
// the storage layer enforces the same cap, so the two can't drift apart silently.
const MAX_BYTES = 150 * 1024 * 1024; // 150 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { variation_id?: unknown; content_type?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }

  const variationId = body.variation_id;
  const contentType = body.content_type;
  const size = body.size;

  if (typeof variationId !== "string" || !variationId) {
    return NextResponse.json({ error: "variation_id is required." }, { status: 400 });
  }
  if (typeof contentType !== "string" || !ALLOWED.includes(contentType)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WEBP or GIF images are allowed." }, { status: 400 });
  }
  if (typeof size === "number" && size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 150 MB or smaller." }, { status: 400 });
  }

  const { data: variation } = await supabase
    .from("ai_variations")
    .select("id, request_id, variation_index")
    .eq("id", variationId)
    .single();

  if (!variation) {
    return NextResponse.json({ error: "Variation not found." }, { status: 404 });
  }

  // Same permission gate as the chat POST: assigned designer or super admin.
  const { data: req } = await supabase
    .from("requests")
    .select("assigned_designer_id, school_id")
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
    return NextResponse.json({ error: "Only the assigned designer can attach images." }, { status: 403 });
  }

  const schoolId = req?.school_id ?? "unknown";
  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1] ?? "png";
  const storagePath = `${schoolId}/${variation.request_id}/ai/${variation.variation_index}/chat-uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("designs")
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    return NextResponse.json({ error: `Could not create upload URL: ${signErr?.message ?? "unknown"}` }, { status: 500 });
  }

  return NextResponse.json({ path: storagePath, token: signed.token });
}
