"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type {
  UserRole,
  RequestStatus,
  SocialPlatform,
} from "@/lib/supabase/types";

export type ActionState = { error?: string; success?: boolean };
export type CreateRequestState = { error?: string; requestId?: string };

const SOCIAL_PLATFORMS: ReadonlyArray<SocialPlatform> = [
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "youtube",
  "other",
];

function isSocialPlatform(v: string): v is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

type RequestRow = {
  id: string;
  school_id: string;
  created_by: string;
  status: RequestStatus;
};

type Actor = {
  userId: string;
  role: UserRole;
};

async function loadActor(): Promise<Actor | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();

  if (error || !profile) return { error: "Profile not found." };
  return { userId: user.id, role: profile.role };
}

async function loadRequestForUpdate(
  id: string,
): Promise<RequestRow | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .select("id, school_id, created_by, status")
    .eq("id", id)
    .single<RequestRow>();
  if (error || !data) return { error: "Request not found or not visible." };
  return data;
}

export async function createRequest(
  _prev: CreateRequestState,
  formData: FormData,
): Promise<CreateRequestState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const schoolId = String(formData.get("school_id") ?? "");
  const requestType = String(formData.get("request_type") ?? "").trim() || null;
  const dueDate = String(formData.get("due_date") ?? "").trim() || null;

  if (!title) return { error: "Give the request a short title." };
  if (!schoolId) return { error: "Pick a school." };

  const actor = await loadActor();
  if ("error" in actor) return { error: actor.error };

  if (
    actor.role !== "teacher" &&
    actor.role !== "school_admin" &&
    actor.role !== "super_admin"
  ) {
    return { error: "Your role can't raise requests." };
  }

  const initialStatus: RequestStatus =
    actor.role === "teacher" ? "draft" : "approved";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requests")
    .insert({
      school_id: schoolId,
      created_by: actor.userId,
      title,
      description: description || null,
      status: initialStatus,
      approved_by: initialStatus === "approved" ? actor.userId : null,
      request_type: requestType as import("@/lib/supabase/types").RequestType | null,
      due_date: dueDate,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) return { error: error?.message ?? "Could not create." };

  revalidatePath("/requests");
  await dispatchPendingPushes();
  return { requestId: data.id };
}

export async function updateRequestDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!id || !title) throw new Error("Missing title or id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "draft") throw new Error("Only drafts can be edited.");
  if (req.created_by !== actor.userId && actor.role !== "super_admin") {
    throw new Error("Only the creator can edit this draft.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ title, description: description || null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  redirect(`/requests/${id}`);
}

export async function submitDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "draft") throw new Error("Only drafts can be submitted.");
  if (req.created_by !== actor.userId && actor.role !== "super_admin") {
    throw new Error("Only the creator can submit this draft.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "pending_admin_approval" })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function approveRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can approve.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "pending_admin_approval") {
    throw new Error("Only pending requests can be approved.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "approved", approved_by: actor.userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function sendBackForChanges(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const feedback = String(formData.get("feedback") ?? "").trim();
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can send back.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "pending_admin_approval") {
    throw new Error("Only pending requests can be sent back.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({
      status: "draft",
      change_feedback: feedback || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function archiveRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  const canArchive =
    actor.role === "super_admin" ||
    actor.role === "school_admin" ||
    req.created_by === actor.userId;
  if (!canArchive) throw new Error("You can't archive this request.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "archived" })
    .eq("id", id);
  if (error) throw new Error(error.message);

  // Mark all unread notifications for this request as read
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("request_id", id)
    .is("read_at", null);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/notifications");
  redirect("/requests");
}

export async function attachUpload(formData: FormData) {
  const requestId = String(formData.get("request_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const mimeType = String(formData.get("mime_type") ?? "");
  const fileSizeRaw = formData.get("file_size");
  const fileSize =
    typeof fileSizeRaw === "string" && fileSizeRaw ? Number(fileSizeRaw) : null;

  if (!requestId || !storagePath) throw new Error("Missing upload fields.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const supabase = await createClient();
  const { error } = await supabase.from("request_uploads").insert({
    request_id: requestId,
    uploaded_by: actor.userId,
    storage_path: storagePath,
    mime_type: mimeType || null,
    file_size: fileSize,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${requestId}`);
}

export async function removeUpload(formData: FormData) {
  const uploadId = String(formData.get("upload_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  if (!uploadId || !requestId || !storagePath) {
    throw new Error("Missing upload fields.");
  }

  const supabase = await createClient();
  const { error: dbErr } = await supabase
    .from("request_uploads")
    .delete()
    .eq("id", uploadId);
  if (dbErr) throw new Error(dbErr.message);

  await supabase.storage.from("request-uploads").remove([storagePath]);

  revalidatePath(`/requests/${requestId}`);
}

export async function pickUpRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "designer" && actor.role !== "super_admin") {
    throw new Error("Only a designer can pick up a request.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "approved") {
    throw new Error("Only approved requests can be picked up.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "in_design", assigned_designer_id: actor.userId })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
}

export async function attachDesign(formData: FormData) {
  const requestId = String(formData.get("request_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  if (!requestId || !storagePath) throw new Error("Missing design fields.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "designer" && actor.role !== "super_admin") {
    throw new Error("Only a designer can upload designs.");
  }

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) throw new Error(req.error);
  if (
    req.status !== "in_design" &&
    req.status !== "design_pending_approval" &&
    req.status !== "changes_requested"
  ) {
    throw new Error("Designs can only be uploaded once the work is in design.");
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("designs")
    .select("version")
    .eq("request_id", requestId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();
  const nextVersion = (existing?.version ?? 0) + 1;

  const { error: insertErr } = await supabase.from("designs").insert({
    request_id: requestId,
    uploaded_by: actor.userId,
    storage_path: storagePath,
    version: nextVersion,
    notes: notes || null,
  });
  if (insertErr) throw new Error(insertErr.message);

  const { error: updateErr } = await supabase
    .from("requests")
    .update({ status: "design_pending_approval" })
    .eq("id", requestId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function removeDesign(formData: FormData) {
  const designId = String(formData.get("design_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  if (!designId || !requestId || !storagePath) {
    throw new Error("Missing design fields.");
  }

  const supabase = await createClient();
  const { error: dbErr } = await supabase
    .from("designs")
    .delete()
    .eq("id", designId);
  if (dbErr) throw new Error(dbErr.message);

  await supabase.storage.from("designs").remove([storagePath]);

  revalidatePath(`/requests/${requestId}`);
}

export async function approveDesign(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can approve designs.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "design_pending_approval") {
    throw new Error("Only designs pending approval can be approved.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "in_design" })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function requestDesignChanges(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const feedback = String(formData.get("feedback") ?? "").trim();
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can request changes.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "design_pending_approval") {
    throw new Error("Only designs pending approval can be sent back.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({
      status: "changes_requested",
      change_feedback: feedback || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function publishRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const platforms = formData.getAll("platform").map(String);
  const urls = formData.getAll("url").map(String);
  if (platforms.length === 0 || platforms.length !== urls.length) {
    throw new Error("Add at least one platform + URL.");
  }

  const links: { platform: SocialPlatform; url: string }[] = [];
  for (let i = 0; i < platforms.length; i++) {
    const platform = platforms[i];
    const url = urls[i].trim();
    if (!url) continue;
    if (!isSocialPlatform(platform)) {
      throw new Error(`Unknown platform: ${platform}`);
    }
    try {
      new URL(url);
    } catch {
      throw new Error(`That doesn't look like a URL: ${url}`);
    }
    links.push({ platform, url });
  }
  if (links.length === 0) throw new Error("Add at least one URL.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "designer" && actor.role !== "super_admin") {
    throw new Error("Only a designer can publish.");
  }

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "in_design") {
    throw new Error(
      "Publish after the school admin approves your design (request must be 'in design').",
    );
  }

  const supabase = await createClient();

  const { count: designCount } = await supabase
    .from("designs")
    .select("id", { count: "exact", head: true })
    .eq("request_id", id);
  if (!designCount || designCount === 0) {
    throw new Error("Upload a design before publishing.");
  }

  const { error: linksErr } = await supabase.from("published_links").insert(
    links.map((l) => ({
      request_id: id,
      posted_by: actor.userId,
      platform: l.platform,
      url: l.url,
    })),
  );
  if (linksErr) throw new Error(linksErr.message);

  const { error: statusErr } = await supabase
    .from("requests")
    .update({ status: "published" })
    .eq("id", id);
  if (statusErr) throw new Error(statusErr.message);

  await supabase
    .from("calendar_items")
    .update({ status: "fulfilled" })
    .eq("linked_request_id", id);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/calendar");
  await dispatchPendingPushes();
}

export async function bulkApproveRequests(formData: FormData) {
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can approve.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ status: "approved", approved_by: actor.userId })
    .in("id", ids)
    .eq("status", "pending_admin_approval");
  if (error) throw new Error(error.message);

  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function reassignDesigner(formData: FormData) {
  const requestId = String(formData.get("request_id") ?? "");
  const designerId = String(formData.get("designer_id") ?? "");
  if (!requestId || !designerId) throw new Error("Missing fields.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "super_admin") {
    throw new Error("Only a super admin can reassign.");
  }

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) throw new Error(req.error);
  if (req.status !== "in_design" && req.status !== "changes_requested" && req.status !== "design_pending_approval") {
    throw new Error("Can only reassign requests that are in design.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("requests")
    .update({ assigned_designer_id: designerId })
    .eq("id", requestId);
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
}

export async function addComment(formData: FormData) {
  const requestId = String(formData.get("request_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!requestId) throw new Error("Missing request_id.");
  if (!body) return;

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  // Decision makers can only comment on published requests (feed feedback)
  if (actor.role === "decision_maker") {
    const req = await loadRequestForUpdate(requestId);
    if ("error" in req) throw new Error(req.error);
    if (req.status !== "published") {
      throw new Error("Decision makers can only give feedback on published posts.");
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("comments").insert({
    request_id: requestId,
    author_id: actor.userId,
    body,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/feed");
}
