import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/ai/chat/attachment  (multipart/form-data)
 * Fields: variation_id (string), file (image)
 *
 * Uploads a user-attached reference/annotation image to the `designs` bucket and
 * returns its storage path. The chat POST then carries these paths in
 * `attachment_paths` so the edit engine can see the annotations.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const variationId = form.get("variation_id");
  const file = form.get("file");

  if (typeof variationId !== "string" || !variationId) {
    return NextResponse.json({ error: "variation_id is required." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG, WEBP or GIF images are allowed." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 10 MB or smaller." }, { status: 400 });
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
  const ext = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] ?? "png";
  const storagePath = `${schoolId}/${variation.request_id}/ai/${variation.variation_index}/chat-uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminClient();
  const { error: uploadErr } = await admin.storage.from("designs").upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
  }

  // Return a short-lived signed URL too, so the client can preview it immediately.
  const { data: signed } = await admin.storage.from("designs").createSignedUrl(storagePath, 3600);

  return NextResponse.json({ path: storagePath, url: signed?.signedUrl ?? null });
}
