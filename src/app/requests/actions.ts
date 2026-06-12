"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import { inngest } from "@/lib/inngest/client";
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

// True for super_admin always, and for school_admin only when the request's
// school is one of their own. Used to gate Edit/Delete actions to admins
// who have authority over the request.
async function callerCanManageRequest(
  actor: Actor,
  req: RequestRow,
): Promise<boolean> {
  if (actor.role === "super_admin") return true;
  if (actor.role !== "school_admin") return false;
  const supabase = await createClient();
  const { data } = await supabase
    .from("school_members")
    .select("school_id")
    .eq("user_id", actor.userId)
    .eq("school_id", req.school_id)
    .maybeSingle<{ school_id: string }>();
  return !!data;
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

  const isCreator = req.created_by === actor.userId;
  const canManage = await callerCanManageRequest(actor, req);
  if (!isCreator && !canManage) {
    throw new Error("You can't edit this request.");
  }

  // Status rules: the creator can only edit while it's still a draft.
  // School admins can also edit after submission, up until approval.
  // Super admin has no status restriction — they can fix anything at any
  // point in the flow.
  const isSuperAdminEditable = actor.role === "super_admin";
  const isAdminEditable =
    canManage &&
    (req.status === "draft" || req.status === "pending_admin_approval");
  const isCreatorEditable = isCreator && req.status === "draft";
  if (!isCreatorEditable && !isAdminEditable && !isSuperAdminEditable) {
    throw new Error(
      "This request can no longer be edited. Archive it instead if needed.",
    );
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

// Hard delete. Restricted to super_admin and school_admin (in their own
// school). Only allowed while the request is still early (draft or pending
// approval) — once design work has started, use Archive instead so design
// history isn't destroyed. Storage objects are removed best-effort; DB
// cascades clean up request_uploads, designs, published_links, comments
// and notifications.
export async function deleteRequest(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const req = await loadRequestForUpdate(id);
  if ("error" in req) throw new Error(req.error);

  const canManage = await callerCanManageRequest(actor, req);
  if (!canManage) throw new Error("You can't delete this request.");
  // School admins can only delete early-stage requests so design history
  // isn't destroyed. Super admin can delete at any status — they're the
  // safety valve when a published post needs to come down entirely.
  if (
    actor.role !== "super_admin" &&
    req.status !== "draft" &&
    req.status !== "pending_admin_approval"
  ) {
    throw new Error(
      "Only draft or pending requests can be deleted. Archive later ones instead.",
    );
  }

  // The RLS policy on public.requests gates DELETE to super_admin only,
  // and storage buckets follow similar admin-only delete rules. We've
  // already enforced the school_admin scope check above, so run the actual
  // teardown via the service-role client.
  const admin = createAdminClient();

  const [uploadsRes, designsRes] = await Promise.all([
    admin
      .from("request_uploads")
      .select("storage_path")
      .eq("request_id", id)
      .returns<{ storage_path: string }[]>(),
    admin
      .from("designs")
      .select("storage_path")
      .eq("request_id", id)
      .returns<{ storage_path: string }[]>(),
  ]);
  const uploadPaths = (uploadsRes.data ?? []).map((u) => u.storage_path);
  const designPaths = (designsRes.data ?? []).map((d) => d.storage_path);
  if (uploadPaths.length > 0) {
    await admin.storage.from("request-uploads").remove(uploadPaths);
  }
  if (designPaths.length > 0) {
    await admin.storage.from("designs").remove(designPaths);
  }

  const { error } = await admin.from("requests").delete().eq("id", id);
  if (error) throw new Error(error.message);

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
  const { error } = await supabase
    .from("request_uploads")
    .upsert(
      {
        request_id: requestId,
        uploaded_by: actor.userId,
        storage_path: storagePath,
        mime_type: mimeType || null,
        file_size: fileSize,
      },
      { onConflict: "request_id,storage_path", ignoreDuplicates: true },
    );
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
    throw new Error("Only a designer or super admin can publish.");
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

// ---------------------------------------------------------------
// AI Generation actions
// ---------------------------------------------------------------

export async function triggerAiGeneration(
  requestId: string,
  posterType: "single" | "carousel",
): Promise<{ error?: string }> {
  const actor = await loadActor();
  if ("error" in actor) return { error: actor.error };

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) return { error: req.error };

  // Only the assigned designer or super_admin can trigger AI generation
  if (actor.role !== "super_admin" && actor.role !== "designer") {
    return { error: "Only a designer can trigger AI generation." };
  }
  if (actor.role === "designer" && req.status !== "in_design" && req.status !== "changes_requested") {
    return { error: "Pick up the request first before assigning to AI." };
  }

  const supabase = await createClient();

  // Mark request as AI-generated
  await supabase
    .from("requests")
    .update({ ai_generated: true })
    .eq("id", requestId);

  // Create the AI generation job — CLOUD engine (Inngest + OpenAI).
  const { data: job, error: jobErr } = await supabase
    .from("ai_generation_jobs")
    .insert({ request_id: requestId, poster_type: posterType, engine: "cloud" })
    .select("id")
    .single<{ id: string }>();

  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Could not create AI job." };
  }

  // Cloud path: always dispatch to the Inngest pipeline on Vercel (OpenAI).
  await inngest.send({
    name: "ai/pipeline.started",
    data: { jobId: job.id, requestId, posterType },
  });

  return {};
}

/**
 * "Generate with Local AI" — creates a LOCAL job (Codex worker). It does NOT
 * dispatch to Inngest; the always-on worker polls for queued engine='local'
 * jobs and runs the same 5-agent pipeline through Codex. Same permissions and
 * flow as triggerAiGeneration — only the engine differs.
 */
export async function triggerLocalAiGeneration(
  requestId: string,
  posterType: "single" | "carousel",
): Promise<{ error?: string }> {
  const actor = await loadActor();
  if ("error" in actor) return { error: actor.error };

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) return { error: req.error };

  if (actor.role !== "super_admin" && actor.role !== "designer") {
    return { error: "Only a designer can trigger AI generation." };
  }
  if (actor.role === "designer" && req.status !== "in_design" && req.status !== "changes_requested") {
    return { error: "Pick up the request first before assigning to AI." };
  }

  const supabase = await createClient();

  await supabase.from("requests").update({ ai_generated: true }).eq("id", requestId);

  const { data: job, error: jobErr } = await supabase
    .from("ai_generation_jobs")
    .insert({ request_id: requestId, poster_type: posterType, engine: "local" })
    .select("id")
    .single<{ id: string }>();

  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Could not create AI job." };
  }

  // Local path: no Inngest — the always-on worker picks up this queued job.
  return {};
}

/**
 * Regenerate AI posters — creates a new job for an already-AI-marked request.
 * Works whether the previous run failed or completed (designer wants a fresh set).
 */
export async function regenerateAi(
  requestId: string,
  posterType: "single" | "carousel",
  title?: string,
  description?: string | null,
  engine: "cloud" | "local" = "cloud",
): Promise<{ error?: string }> {
  const actor = await loadActor();
  if ("error" in actor) return { error: actor.error };

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) return { error: req.error };

  if (actor.role !== "super_admin" && actor.role !== "designer") {
    return { error: "Only a designer can trigger AI generation." };
  }

  const supabase = await createClient();

  // Ensure ai_generated is set + update title/description if changed
  const updates: { ai_generated: boolean; title?: string; description?: string | null } = { ai_generated: true };
  if (title) updates.title = title;
  if (description !== undefined) updates.description = description;
  await supabase
    .from("requests")
    .update(updates)
    .eq("id", requestId);

  // Create a new AI generation job (old one stays for history)
  const { data: job, error: jobErr } = await supabase
    .from("ai_generation_jobs")
    .insert({ request_id: requestId, poster_type: posterType, engine })
    .select("id")
    .single<{ id: string }>();

  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Could not create AI job." };
  }

  // Cloud regenerate → Inngest; local regenerate → picked up by the worker.
  if (engine === "cloud") {
    await inngest.send({
      name: "ai/pipeline.started",
      data: { jobId: job.id, requestId, posterType },
    });
  }

  return {};
}

export async function acceptAiVariation(formData: FormData) {
  const variationId = String(formData.get("variation_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  if (!variationId || !requestId) throw new Error("Missing fields.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);

  const req = await loadRequestForUpdate(requestId);
  if ("error" in req) throw new Error(req.error);

  // Only the assigned designer or super_admin can accept a variation
  const isAssigned = actor.role === "designer" && req.status === "in_design";
  if (!isAssigned && actor.role !== "super_admin") {
    throw new Error("Only the assigned designer can accept a variation.");
  }

  const supabase = await createClient();

  // Load the variation to get its storage paths
  const { data: variation, error: varErr } = await supabase
    .from("ai_variations")
    .select("id, storage_paths, variation_index, poster_type")
    .eq("id", variationId)
    .single();
  if (varErr || !variation) throw new Error("Variation not found.");

  // Mark variation as accepted
  const { error: updateErr } = await supabase
    .from("ai_variations")
    .update({ is_accepted: true })
    .eq("id", variationId);
  if (updateErr) throw new Error(updateErr.message);

  // Copy AI-generated poster(s) into the designs table so the existing
  // review flow works unchanged
  const admin = createAdminClient();
  // Single poster: chat edits are appended (history), so accept only the LATEST
  // version. Carousel: every entry is a real page — copy them all.
  const pathsToCopy =
    variation.poster_type === "single" && variation.storage_paths.length > 0
      ? [variation.storage_paths[variation.storage_paths.length - 1]]
      : variation.storage_paths;
  for (const path of pathsToCopy) {
    await admin.from("designs").insert({
      request_id: requestId,
      uploaded_by: actor.userId,
      storage_path: path,
      notes: `AI variation ${variation.variation_index} — accepted by designer`,
    });
  }

  // Transition request to design_pending_approval for school admin review
  const { error: statusErr } = await supabase
    .from("requests")
    .update({ status: "design_pending_approval" })
    .eq("id", requestId);
  if (statusErr) throw new Error(statusErr.message);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/requests");
  await dispatchPendingPushes();
}
