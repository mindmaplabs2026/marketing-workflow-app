import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  NotificationType,
  RequestStatus,
  SocialPlatform,
  UserRole,
} from "@/lib/supabase/types";
import { STATUS_BADGE_CLASS, getStatusLabel } from "../status";
import {
  addComment,
  approveDesign,
  approveRequest,
  archiveRequest,
  deleteRequest,
  pickUpRequest,
  reassignDesigner,
  removeDesign,
  removeUpload,
  requestDesignChanges,
  sendBackForChanges,
  submitDraft,
} from "../actions";
import { UploadDesignForm } from "./upload-design-form";
import { PublishForm } from "./publish-form";
import { ConfirmForm } from "@/components/confirm-form";
import { CommentThread } from "@/components/comment-thread";
import { ProgressTracker } from "@/components/progress-tracker";
import { BackLink } from "@/components/back-link";
import { SubmitButton } from "@/components/submit-button";
import { AssetDownloadGrid, type AssetItem } from "@/components/asset-download-grid";
import { AiGenerationStatus } from "./ai-generation-status";
import { AiVariations } from "./ai-variations";
import { AiGenerateButton } from "./ai-generate-button";
import { AiRegenerateButton } from "./ai-regenerate-button";
import type { AiJobStatus } from "@/lib/supabase/types";

type RequestRow = {
  id: string;
  school_id: string;
  created_by: string;
  assigned_designer_id: string | null;
  approved_by: string | null;
  title: string;
  description: string | null;
  status: RequestStatus;
  request_type: string | null;
  due_date: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  social_post: "Social post",
  poster: "Poster",
  newsletter: "Newsletter",
  video: "Video",
  other: "Other",
};

type UploadRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string;
  created_at: string;
};

type DesignRow = {
  id: string;
  storage_path: string;
  version: number;
  notes: string | null;
  uploaded_by: string;
  created_at: string;
};

type PublishedLinkRow = {
  id: string;
  platform: SocialPlatform;
  url: string;
  posted_by: string;
  posted_at: string;
};

type ActivityRow = {
  id: string;
  type: NotificationType;
  body: string;
  feedback: string | null;
  actor_id: string | null;
  created_at: string;
};

const ACTIVITY_VERB: Record<NotificationType, string> = {
  request_submitted_for_approval: "submitted for approval",
  request_approved: "approved the request",
  request_sent_back_to_draft: "sent the draft back",
  design_uploaded_for_review: "uploaded a design",
  design_approved: "approved the design",
  design_changes_requested: "requested design changes",
  request_published: "published",
  calendar_item_approved: "approved a calendar item",
  // Membership notifications have no request_id, so this verb never
  // actually renders in the per-request timeline — but the Record type
  // needs every NotificationType key present.
  user_added_to_school: "added someone to a school",
  ai_generation_completed: "AI generation completed",
  ai_generation_failed: "AI generation failed",
};

const SIGNED_URL_TTL_SECONDS = 60 * 60;

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  youtube: "YouTube",
  other: "Link",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "teacher";

  const { data: req } = await supabase
    .from("requests")
    .select(
      "id, school_id, created_by, assigned_designer_id, approved_by, title, description, status, request_type, due_date, ai_generated, created_at, updated_at",
    )
    .eq("id", id)
    .single<RequestRow>();
  if (!req) notFound();

  // Fetch AI generation data if this is an AI-generated request
  let aiJob: { id: string; status: AiJobStatus; error_message: string | null; cost_tracking: { total_usd: number } | null } | null = null;
  let aiVariations: {
    id: string;
    variation_index: number;
    creative_brief: Record<string, unknown>;
    storage_paths: string[];
    poster_type: "single" | "carousel";
    is_accepted: boolean;
    chat_rounds_used: number;
  }[] = [];

  if (req.ai_generated) {
    // Fetch the latest job (for progress/failure status)
    const { data: jobData } = await supabase
      .from("ai_generation_jobs")
      .select("id, status, error_message, cost_tracking")
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    aiJob = jobData as { id: string; status: AiJobStatus; error_message: string | null; cost_tracking: { total_usd: number } | null } | null;

    // Fetch ALL variations across all jobs for this request
    const { data: vars } = await supabase
      .from("ai_variations")
      .select("id, variation_index, creative_brief, storage_paths, poster_type, is_accepted, chat_rounds_used")
      .eq("request_id", id)
      .order("created_at", { ascending: true });
    aiVariations = (vars ?? []) as typeof aiVariations;
  }

  const [
    { data: schoolRow },
    { data: uploads },
    { data: designs },
    { data: links },
    { data: creator },
    { data: designer },
    activityRes,
  ] = await Promise.all([
    supabase
      .from("schools")
      .select("name")
      .eq("id", req.school_id)
      .single<{ name: string }>(),
    supabase
      .from("request_uploads")
      .select("id, storage_path, mime_type, file_size, uploaded_by, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: true })
      .returns<UploadRow[]>(),
    supabase
      .from("designs")
      .select("id, storage_path, version, notes, uploaded_by, created_at")
      .eq("request_id", id)
      .order("version", { ascending: false })
      .returns<DesignRow[]>(),
    supabase
      .from("published_links")
      .select("id, platform, url, posted_by, posted_at")
      .eq("request_id", id)
      .order("posted_at", { ascending: true })
      .returns<PublishedLinkRow[]>(),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", req.created_by)
      .single<{ full_name: string | null; email: string | null }>(),
    req.assigned_designer_id
      ? supabase
          .from("profiles")
          .select("full_name, email")
          .eq("id", req.assigned_designer_id)
          .single<{ full_name: string | null; email: string | null }>()
      : Promise.resolve({ data: null }),
    role === "decision_maker"
      ? Promise.resolve({ data: [] as ActivityRow[] })
      : supabase
          .from("notifications")
          .select("id, type, body, feedback, actor_id, created_at")
          .eq("request_id", id)
          .order("created_at", { ascending: true })
          .returns<ActivityRow[]>(),
  ]);

  const uploadsList = uploads ?? [];
  const designsList = designs ?? [];
  const linksList = links ?? [];

  // Each status change fans out 1 notification per recipient. Collapse those
  // into a single timeline entry keyed by (type, actor, created_at).
  const activityRaw = activityRes.data ?? [];
  const seen = new Set<string>();
  const activity: ActivityRow[] = [];
  for (const row of activityRaw) {
    const key = `${row.type}|${row.actor_id ?? ""}|${row.created_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    activity.push(row);
  }

  const activityActorIds = Array.from(
    new Set(activity.map((a) => a.actor_id).filter((x): x is string => !!x)),
  );
  let activityActors: { id: string; full_name: string | null; email: string | null }[] = [];
  if (activityActorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", activityActorIds)
      .returns<{ id: string; full_name: string | null; email: string | null }[]>();
    activityActors = data ?? [];
  }
  const activityActorById = new Map(
    activityActors.map((p) => [p.id, p.full_name?.trim() || p.email || null]),
  );

  const signedUploadUrls = new Map<string, string>();
  if (uploadsList.length > 0) {
    const { data: signed } = await supabase.storage
      .from("request-uploads")
      .createSignedUrls(
        uploadsList.map((u) => u.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    for (const e of signed ?? []) {
      if (e.signedUrl && e.path) signedUploadUrls.set(e.path, e.signedUrl);
    }
  }

  const signedDesignUrls = new Map<string, string>();
  if (designsList.length > 0 && role !== "decision_maker") {
    const { data: signed } = await supabase.storage
      .from("designs")
      .createSignedUrls(
        designsList.map((d) => d.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    for (const e of signed ?? []) {
      if (e.signedUrl && e.path) signedDesignUrls.set(e.path, e.signedUrl);
    }
  }

  // -- Comments --
  const { data: rawComments } = await supabase
    .from("comments")
    .select("id, author_id, body, created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .returns<{ id: string; author_id: string; body: string; created_at: string }[]>();

  const commentAuthorIds = Array.from(
    new Set((rawComments ?? []).map((c) => c.author_id)),
  );
  let commentAuthors: { id: string; full_name: string | null; email: string | null; role: UserRole }[] = [];
  if (commentAuthorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .in("id", commentAuthorIds)
      .returns<{ id: string; full_name: string | null; email: string | null; role: UserRole }[]>();
    commentAuthors = data ?? [];
  }
  const commentAuthorMap = new Map(
    commentAuthors.map((p) => [p.id, { name: p.full_name?.trim() || p.email || "A team member", role: p.role }]),
  );

  const comments = (rawComments ?? []).map((c) => ({
    id: c.id,
    authorName: commentAuthorMap.get(c.author_id)?.name ?? "A team member",
    authorRole: commentAuthorMap.get(c.author_id)?.role ?? "teacher",
    body: c.body,
    createdAt: c.created_at,
  }));

  const canComment = role !== "decision_maker";

  // Designers list for reassignment (super_admin only)
  const canReassign =
    role === "super_admin" &&
    (req.status === "in_design" || req.status === "changes_requested" || req.status === "design_pending_approval");
  let designerOptions: { id: string; name: string }[] = [];
  if (canReassign) {
    const { data: designers } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "designer")
      .returns<{ id: string; full_name: string | null; email: string | null }[]>();
    designerOptions = (designers ?? [])
      .filter((d) => d.id !== req.assigned_designer_id)
      .map((d) => ({ id: d.id, name: d.full_name?.trim() || d.email || d.id }));
  }

  const isCreator = req.created_by === user.id;
  const isReviewer = role === "school_admin" || role === "super_admin";
  const isAssignedDesigner =
    (role === "designer" || role === "super_admin") &&
    req.assigned_designer_id === user.id;

  // A school_admin is "in scope" for this request only when its school is
  // one of theirs. Super_admin is always in scope. Used to gate Edit + the
  // new hard-Delete to admins with authority over this request.
  let isSchoolAdminInScope = false;
  if (role === "school_admin") {
    const { data: membership } = await supabase
      .from("school_members")
      .select("school_id")
      .eq("user_id", user.id)
      .eq("school_id", req.school_id)
      .maybeSingle<{ school_id: string }>();
    isSchoolAdminInScope = !!membership;
  }
  const isManagingAdmin =
    role === "super_admin" || (role === "school_admin" && isSchoolAdminInScope);

  // Teachers can edit only their own draft. School admins can also edit
  // after the teacher has submitted, until the request is approved — so
  // they can fix typos without forcing the teacher to recreate it. Super
  // admin can edit and delete at any status (including after approval /
  // publish) so the team has a way to fix mistakes downstream.
  const isSuperAdmin = role === "super_admin";
  const canEdit =
    isSuperAdmin ||
    (isCreator && req.status === "draft") ||
    (isManagingAdmin &&
      (req.status === "draft" || req.status === "pending_admin_approval"));
  const canDelete =
    isSuperAdmin ||
    (isManagingAdmin &&
      (req.status === "draft" || req.status === "pending_admin_approval"));
  const canSubmit = isCreator && req.status === "draft";
  const canApprove = isReviewer && req.status === "pending_admin_approval";
  const canSendBack = isReviewer && req.status === "pending_admin_approval";
  const canPickUp =
    (role === "designer" || role === "super_admin") && req.status === "approved";
  const canUploadDesign =
    isAssignedDesigner &&
    (req.status === "in_design" || req.status === "changes_requested");
  const canApproveDesign = isReviewer && req.status === "design_pending_approval";
  const canRequestDesignChanges =
    isReviewer && req.status === "design_pending_approval";
  const awaitingPublish =
    req.status === "in_design" && designsList.length > 0;
  // Designer (assigned) or super admin can publish after design is approved.
  const canPublish = awaitingPublish && (isSuperAdmin || isAssignedDesigner);
  // Designer can trigger AI generation when they've picked up the request.
  // Show the button if no AI job is currently running (queued/understanding/creative/generating).
  const aiJobRunning = aiJob && !["completed", "failed"].includes(aiJob.status);
  const canTriggerAi =
    (isAssignedDesigner || isSuperAdmin) &&
    !aiJobRunning &&
    (req.status === "in_design" || req.status === "changes_requested");
  const canArchive =
    (isCreator || isReviewer) &&
    req.status !== "archived" &&
    req.status !== "published";

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/requests">All requests</BackLink>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {req.title}
          </h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
              awaitingPublish
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                : STATUS_BADGE_CLASS[req.status]
            }`}
          >
            {getStatusLabel(req.status, role, req, awaitingPublish)}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {creator?.full_name?.trim() || creator?.email || "A team member"}
          {schoolRow?.name ? ` · ${schoolRow.name}` : ""} ·{" "}
          {formatDateTime(req.created_at)}
          {designer?.full_name && (
            <> · Designer: {designer.full_name}</>
          )}
        </p>
      </div>

      <ProgressTracker status={req.status} awaitingPublish={awaitingPublish} />

      {canReassign && designerOptions.length > 0 && (
        <form action={reassignDesigner} className="flex items-center gap-2">
          <input type="hidden" name="request_id" value={req.id} />
          <span className="text-xs text-zinc-500">Reassign to:</span>
          <select
            name="designer_id"
            required
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {designerOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            Reassign
          </button>
        </form>
      )}

      {(req.request_type || req.due_date) && (
        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          {req.request_type && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {REQUEST_TYPE_LABELS[req.request_type] ?? req.request_type}
            </span>
          )}
          {req.due_date && (
            <span className={`rounded-full px-2 py-0.5 font-medium ${
              new Date(req.due_date) < new Date()
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}>
              Due: {new Date(req.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Kolkata" })}
            </span>
          )}
        </div>
      )}

      {req.description && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <p className="whitespace-pre-wrap">{req.description}</p>
        </div>
      )}

      {uploadsList.length > 0 && (
        <AssetDownloadGrid
          requestId={req.id}
          heading={<>From the school ({uploadsList.length})</>}
          items={uploadsList.map<AssetItem>((u) => {
            const name = u.storage_path.split("/").pop() ?? "file";
            const canDelete =
              u.uploaded_by === user.id || role === "super_admin";
            return {
              id: u.id,
              kind: "upload",
              name,
              signedUrl: signedUploadUrls.get(u.storage_path) ?? null,
              mimeType: u.mime_type,
              byteSize: u.file_size,
              removeAction: canDelete ? removeUpload : undefined,
              removeFields: canDelete
                ? {
                    upload_id: u.id,
                    request_id: req.id,
                    storage_path: u.storage_path,
                  }
                : undefined,
              removeConfirm: canDelete
                ? "Remove this file? This cannot be undone."
                : undefined,
            };
          })}
        />
      )}

      {/* AI: trigger / regenerate button for designer */}
      {canTriggerAi && !aiVariations.some((v) => v.is_accepted) && (
        req.ai_generated
          ? <AiRegenerateButton requestId={req.id} currentTitle={req.title} currentDescription={req.description ?? ""} />
          : <AiGenerateButton requestId={req.id} />
      )}

      {/* AI: generation progress (visible to designer + super_admin) */}
      {req.ai_generated && aiJob && aiJob.status !== "completed" && aiJob.status !== "failed" && (isAssignedDesigner || isSuperAdmin) && (
        <AiGenerationStatus
          jobId={aiJob.id}
          initialStatus={aiJob.status}
        />
      )}

      {/* AI: failed — show error + regenerate button */}
      {req.ai_generated && aiJob?.status === "failed" && (isAssignedDesigner || isSuperAdmin) && (
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              AI generation failed
            </p>
            {aiJob.error_message && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {aiJob.error_message}
              </p>
            )}
          </div>
          <AiRegenerateButton requestId={req.id} currentTitle={req.title} currentDescription={req.description ?? ""} />
        </div>
      )}

      {/* AI: variation review — show ALL variations across all jobs */}
      {req.ai_generated && aiVariations.length > 0 && (isAssignedDesigner || isSuperAdmin) && (
        <>
          <AiVariations
            requestId={req.id}
            variations={aiVariations.map((v) => ({
              ...v,
              creative_brief: v.creative_brief as {
                direction?: string;
                theme?: string;
                colorPalette?: string[];
                textContent?: { headline?: string };
              },
            }))}
            totalCostUsd={aiJob?.cost_tracking?.total_usd ?? null}
          />
        </>
      )}

      {designsList.length > 0 && role !== "decision_maker" && (
        <AssetDownloadGrid
          requestId={req.id}
          heading={<>Designs ({designsList.length})</>}
          showVersion
          items={designsList.map<AssetItem>((d) => {
            const name = d.storage_path.split("/").pop() ?? "design";
            const canDelete =
              d.uploaded_by === user.id || role === "super_admin";
            return {
              id: d.id,
              kind: "design",
              name,
              signedUrl: signedDesignUrls.get(d.storage_path) ?? null,
              mimeType: null,
              version: d.version,
              footerText: d.notes,
              removeAction: canDelete ? removeDesign : undefined,
              removeFields: canDelete
                ? {
                    design_id: d.id,
                    request_id: req.id,
                    storage_path: d.storage_path,
                  }
                : undefined,
              removeConfirm: canDelete
                ? "Remove this design version? This cannot be undone."
                : undefined,
            };
          })}
        />
      )}

      {linksList.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Live links
          </h2>
          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {linksList.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  {PLATFORM_LABEL[l.platform]}
                </span>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  {l.url}
                </a>
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatDateTime(l.posted_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canUploadDesign && (
        <section className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {req.status === "changes_requested"
              ? "Upload a new revision"
              : designsList.length > 0
                ? "Upload another revision"
                : "Upload your design"}
          </p>
          <UploadDesignForm requestId={req.id} schoolId={req.school_id} />
        </section>
      )}

      {canPublish && (
        <section className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Ready to publish
          </p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Post to the school's social handles, then paste the live links here.
          </p>
          <PublishForm requestId={req.id} />
        </section>
      )}

      {role !== "decision_maker" && activity.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Activity
          </h2>
          <ol className="space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            {activity.map((a) => {
              const actorName =
                (a.actor_id && activityActorById.get(a.actor_id)?.trim()) ||
                "A team member";
              return (
                <li key={a.id} className="relative text-xs">
                  <span className="absolute -left-[1.3rem] top-1.5 h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-600" />
                  <p className="text-zinc-700 dark:text-zinc-300">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {actorName}
                    </span>{" "}
                    {ACTIVITY_VERB[a.type]}
                  </p>
                  {a.feedback && (
                    <p className="mt-0.5 italic text-zinc-600 dark:text-zinc-400">
                      &ldquo;{a.feedback}&rdquo;
                    </p>
                  )}
                  <p className="text-[10px] text-zinc-500">
                    {formatDateTime(a.created_at)}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {canComment && (
        <CommentThread
          comments={comments}
          requestId={req.id}
          addCommentAction={addComment}
        />
      )}

      <section className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        {canEdit && (
          <Link
            href={`/requests/${req.id}/edit`}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Edit
          </Link>
        )}
        {canSubmit && (
          <form action={submitDraft}>
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
              pendingLabel="Submitting..."
            >
              Submit for approval
            </SubmitButton>
          </form>
        )}
        {canApprove && (
          <form action={approveRequest}>
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
              pendingLabel="Approving..."
            >
              Approve
            </SubmitButton>
          </form>
        )}
        {canSendBack && (
          <form action={sendBackForChanges} className="w-full">
            <input type="hidden" name="id" value={req.id} />
            <textarea
              name="feedback"
              placeholder="What should be changed? (optional)"
              rows={2}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <SubmitButton
              className="mt-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              pendingLabel="Sending back..."
            >
              Send back for changes
            </SubmitButton>
          </form>
        )}
        {canPickUp && (
          <form action={pickUpRequest}>
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
              pendingLabel="Picking up..."
            >
              Pick this up
            </SubmitButton>
          </form>
        )}
        {canApproveDesign && (
          <form action={approveDesign}>
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
              pendingLabel="Approving..."
            >
              Approve design
            </SubmitButton>
          </form>
        )}
        {canRequestDesignChanges && (
          <form action={requestDesignChanges} className="w-full">
            <input type="hidden" name="id" value={req.id} />
            <textarea
              name="feedback"
              placeholder="What should the designer change? (optional)"
              rows={2}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <SubmitButton
              className="mt-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              pendingLabel="Sending..."
            >
              Request changes
            </SubmitButton>
          </form>
        )}
        {canArchive && (
          <ConfirmForm
            action={archiveRequest}
            message="Archive this request? It will be moved to the archived section."
            className={canDelete ? "" : "ml-auto"}
          >
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
            >
              Archive
            </button>
          </ConfirmForm>
        )}
        {canDelete && (
          <ConfirmForm
            action={deleteRequest}
            title="Delete request?"
            message="This permanently removes the request and any attachments. Use Archive instead to keep a record."
            confirmLabel="Delete"
            className="ml-auto"
          >
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
            >
              Delete
            </button>
          </ConfirmForm>
        )}
      </section>
    </div>
  );
}
