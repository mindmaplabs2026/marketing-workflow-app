import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Flag,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type {
  NotificationType,
  RequestActivityType,
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
import { SubmitButton } from "@/components/submit-button";
import { ToastForm } from "@/components/toast-form";
import { AssetDownloadGrid, type AssetItem } from "@/components/asset-download-grid";
import { AiGenerationStatus } from "./ai-generation-status";
import { AiVariations } from "./ai-variations";
import { AiGenerateButton } from "./ai-generate-button";
import { AiRegenerateButton } from "./ai-regenerate-button";
import { MobileRequestActionsMenu } from "./mobile-request-actions-menu";
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

type NotificationActivityRow = {
  id: string;
  type: NotificationType;
  body: string;
  feedback: string | null;
  actor_id: string | null;
  created_at: string;
};

type RequestActivityRow = {
  id: string;
  type: RequestActivityType;
  metadata: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
};

type TimelineActivityRow = {
  id: string;
  type: RequestActivityType | NotificationType;
  actor_id: string | null;
  created_at: string;
  feedback?: string | null;
  source: "activity" | "notification" | "synthetic";
};

const ACTIVITY_VERB: Record<RequestActivityType | NotificationType, string> = {
  request_created: "raised the request",
  request_submitted: "submitted the request",
  request_picked_up: "picked this up for design",
  request_sent_back: "sent the request back",
  design_submitted: "submitted a design",
  request_archived: "archived the request",
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
  let aiJob: { id: string; status: AiJobStatus; error_message: string | null; cost_tracking: { total_usd: number } | null; poster_type: string | null } | null = null;
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
      .select("id, status, error_message, cost_tracking, poster_type")
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    aiJob = jobData as { id: string; status: AiJobStatus; error_message: string | null; cost_tracking: { total_usd: number } | null; poster_type: string | null } | null;

    // Fetch ALL variations across all jobs for this request
    const { data: vars } = await supabase
      .from("ai_variations")
      .select("id, variation_index, creative_brief, storage_paths, poster_type, is_accepted, chat_rounds_used")
      .eq("request_id", id)
      .order("created_at", { ascending: false });
    aiVariations = (vars ?? []) as typeof aiVariations;
  }

  const [
    { data: schoolRow },
    { data: uploads },
    { data: designs },
    { data: links },
    { data: creator },
    { data: designer },
    requestActivityRes,
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
      ? Promise.resolve({ data: [] as RequestActivityRow[] })
      : supabase
          .from("request_activities")
          .select("id, type, metadata, actor_id, created_at")
          .eq("request_id", id)
          .order("created_at", { ascending: true })
          .returns<RequestActivityRow[]>(),
    role === "decision_maker"
      ? Promise.resolve({ data: [] as NotificationActivityRow[] })
      : supabase
          .from("notifications")
          .select("id, type, body, feedback, actor_id, created_at")
          .eq("request_id", id)
          .order("created_at", { ascending: true })
          .returns<NotificationActivityRow[]>(),
  ]);

  const uploadsList = uploads ?? [];
  const designsList = designs ?? [];
  const linksList = links ?? [];

  const requestActivityRaw = requestActivityRes.data ?? [];
  // Each status change fans out 1 notification per recipient. Collapse those
  // into a single fallback timeline entry keyed by (type, actor, created_at).
  const notificationActivityRaw = activityRes.data ?? [];
  // AI generation is an internal MindMap tool — school-side users (school_admin,
  // teacher) must not see any trace that a design was AI-generated. Only internal
  // members (super_admin / designer) see AI activity entries.
  const isInternalMember = role === "super_admin" || role === "designer";
  const HIDDEN_FROM_EXTERNAL: NotificationType[] = [
    "ai_generation_completed",
    "ai_generation_failed",
  ];
  const seen = new Set<string>();
  const notificationActivity: TimelineActivityRow[] = [];
  for (const row of notificationActivityRaw) {
    if (!isInternalMember && HIDDEN_FROM_EXTERNAL.includes(row.type)) continue;
    const key = `${row.type}|${row.actor_id ?? ""}|${row.created_at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notificationActivity.push({
      id: row.id,
      type: row.type,
      actor_id: row.actor_id,
      created_at: row.created_at,
      feedback: row.feedback,
      source: "notification",
    });
  }

  const canonicalActivity: TimelineActivityRow[] = requestActivityRaw.map((row) => ({
    id: row.id,
    type: row.type,
    actor_id: row.actor_id,
    created_at: row.created_at,
    feedback:
      typeof row.metadata?.feedback === "string" ? row.metadata.feedback : null,
    source: "activity",
  }));
  const activity: TimelineActivityRow[] =
    canonicalActivity.length > 0
      ? canonicalActivity
      : [
          {
            id: `created-${req.id}`,
            type: "request_created" as const,
            actor_id: req.created_by,
            created_at: req.created_at,
            source: "synthetic" as const,
          },
          ...notificationActivity,
        ].sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );

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
  // Super admin can trigger AI at ANY status — this mirrors the server action
  // (triggerLocalAiGeneration), which only restricts *designers* to
  // in_design/changes_requested. A designer must have picked the request up first.
  const canTriggerAi =
    !aiJobRunning &&
    (isSuperAdmin ||
      (isAssignedDesigner &&
        (req.status === "in_design" || req.status === "changes_requested")));
  const canArchive =
    (isCreator || isReviewer) &&
    req.status !== "archived" &&
    req.status !== "published";
  const ownerName = creator?.full_name?.trim() || creator?.email || "A team member";
  const statusLabel = getStatusLabel(req.status, role, req, awaitingPublish);
  const dueDateLabel = req.due_date
    ? new Date(req.due_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : null;
  const latestActivity = activity.at(-1);
  const latestActorName =
    latestActivity?.actor_id && activityActorById.get(latestActivity.actor_id)
      ? activityActorById.get(latestActivity.actor_id)
      : "A team member";
  const currentStageText =
    awaitingPublish && req.status === "in_design"
      ? "Ready to publish"
      : statusLabel;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_18%_8%,rgba(147,197,253,0.18),transparent_28%),radial-gradient(circle_at_76%_5%,rgba(167,139,250,0.2),transparent_32%),linear-gradient(180deg,#ffffff_0%,#f8fbff_48%,#ffffff_100%)] px-3 pb-28 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 lg:min-h-[calc(100dvh-3.5rem)] lg:px-8 lg:pb-3 lg:pt-3 xl:px-10 dark:bg-none dark:bg-zinc-950">
      <div className="mx-auto grid w-full max-w-[1328px] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_292px] lg:gap-7 xl:grid-cols-[minmax(0,1fr)_312px]">
        <main className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/requests"
            aria-label="Back to all requests"
            className="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white/90 text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/70 backdrop-blur-xl transition hover:-translate-x-0.5 hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-violet-100 motion-reduce:transform-none dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="h-5 w-5 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none"
              aria-hidden="true"
            >
              <path
                d="M15 18 9 12l6-6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <p className="truncate text-base font-semibold text-slate-950 dark:text-zinc-50">
            Request details
          </p>
        </div>

        <div className="flex justify-end">
          <MobileRequestActionsMenu
            requestId={req.id}
            canEdit={canEdit}
            canArchive={canArchive}
            canDelete={canDelete}
          />
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur-xl lg:hidden dark:border-zinc-800 dark:bg-zinc-900/85">
        <div className="space-y-3">
          <h1 className="text-[1.45rem] font-semibold leading-tight tracking-tight text-slate-950 dark:text-zinc-50">
            {req.title}
          </h1>
          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-zinc-400">
            <span>{ownerName}</span>
            {schoolRow?.name && (
              <>
                <span className="h-1 w-1 rounded-full bg-slate-300" />
                <span>{schoolRow.name}</span>
              </>
            )}
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span>{formatDateTime(req.created_at)}</span>
          </p>
        </div>
        <div className="mt-4">
          <ProgressTracker
            status={req.status}
            awaitingPublish={awaitingPublish}
            compactMobile
          />
        </div>
      </section>

      <div className="hidden lg:block">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            <Link
              href="/requests"
              aria-label="Back to all requests"
              className="group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/90 bg-white/90 text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/70 backdrop-blur-xl transition hover:-translate-x-0.5 hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-violet-100 motion-reduce:transform-none dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:text-zinc-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none"
                aria-hidden="true"
              >
                <path
                  d="M15 18 9 12l6-6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <h1 className="min-w-0 text-2xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-3xl dark:text-zinc-50">
              {req.title}
            </h1>
          </div>
          <span
            className={`inline-flex h-4 shrink-0 items-center rounded-full px-2.5 text-[8px] font-bold uppercase leading-none tracking-wide shadow-sm lg:mt-1 ${
              awaitingPublish
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
                : STATUS_BADGE_CLASS[req.status]
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 sm:text-sm dark:text-zinc-400">
          <span>{ownerName}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          {schoolRow?.name && (
            <>
              <span>{schoolRow.name}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
            </>
          )}
          <span>{formatDateTime(req.created_at)}</span>
          {designer?.full_name && (
            <>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>Designer: {designer.full_name}</span>
            </>
          )}
        </p>
        <p className="mt-1 hidden text-xs text-zinc-500">
          {creator?.full_name?.trim() || creator?.email || "A team member"}
          {schoolRow?.name ? ` · ${schoolRow.name}` : ""} ·{" "}
          {formatDateTime(req.created_at)}
          {designer?.full_name && (
            <> · Designer: {designer.full_name}</>
          )}
        </p>
      </div>

      <div className="hidden lg:block">
        <ProgressTracker status={req.status} awaitingPublish={awaitingPublish} />
      </div>

      {canReassign && designerOptions.length > 0 && (
        <ToastForm action={reassignDesigner} success="Designer reassigned" className="flex flex-wrap items-center gap-2">
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
        </ToastForm>
      )}

      <section className="rounded-2xl border border-slate-200/80 bg-white/88 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur-xl sm:p-5 dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950 sm:text-lg dark:text-zinc-50">
              Request brief
            </h2>
            {req.description ? (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-zinc-300">
                {req.description}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
                No brief details added yet.
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold sm:px-4 sm:text-xs ${
              awaitingPublish
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                : STATUS_BADGE_CLASS[req.status]
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50">
          <div className="flex min-w-0 items-center gap-2 border-r border-slate-200 px-3 py-3 dark:border-zinc-800">
            <Flag className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-slate-500">Priority</span>
              <span className="block font-semibold text-orange-600">NA</span>
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 border-r border-slate-200 px-3 py-3 dark:border-zinc-800">
            <CalendarDays className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-slate-500">Due</span>
              <span
                className={`block font-semibold ${
                  req.due_date && new Date(req.due_date) < new Date()
                    ? "text-orange-600"
                    : "text-slate-800 dark:text-zinc-200"
                }`}
              >
                {dueDateLabel ?? "NA"}
              </span>
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-3 py-3">
            <UserRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-slate-500">Owner</span>
              <span className="block truncate font-semibold text-slate-800 dark:text-zinc-200">
                {ownerName}
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-3 lg:hidden">
        <section className="rounded-2xl border border-slate-200/80 bg-white/88 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/80">
          <h2 className="text-base font-semibold text-slate-950 dark:text-zinc-50">
            Approval status
          </h2>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
              Current stage
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-950 dark:text-zinc-50">
              {currentStageText}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-violet-600 px-3 py-2.5 text-center text-xs font-semibold text-white shadow-[0_14px_30px_rgba(124,58,237,0.24)]">
              {canPickUp
                ? "Ready for design"
                : canApprove || canApproveDesign
                  ? "Needs approval"
                  : canUploadDesign
                    ? "Design in progress"
                    : statusLabel}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center text-xs font-semibold text-slate-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {designer?.full_name ? designer.full_name : "Unassigned"}
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-xs font-semibold text-slate-950 dark:text-zinc-50">
              Checklist
            </h3>
            <ul className="mt-2 grid gap-2 text-xs text-slate-600 dark:text-zinc-300">
              {[
                "Goal and audience clear",
                "Deadline confirmed",
                "Required copy attached",
                "Assets ready",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {role !== "decision_maker" && latestActivity && (
          <section className="rounded-2xl border border-slate-200/80 bg-white/88 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ring-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/80">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-950 dark:text-zinc-50">
                Latest activity
              </h2>
              <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="mt-3 flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-950 dark:text-zinc-50">
                    {ACTIVITY_VERB[latestActivity.type]}
                  </p>
                  <p className="shrink-0 text-[11px] text-slate-400">
                    {formatDateTime(latestActivity.created_at)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  {latestActorName}
                  {latestActivity.feedback ? `: ${latestActivity.feedback}` : ""}
                </p>
              </div>
            </div>
          </section>
        )}
      </div>

      {uploadsList.length > 0 && (
        <AssetDownloadGrid
          requestId={req.id}
          heading={<>From the school ({uploadsList.length})</>}
          collapseAfter={3}
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

      {/* AI: trigger / regenerate button for designer.
          When the latest job FAILED, the failed-section below renders its own
          regenerate button, so skip this one to avoid a duplicate. */}
      {canTriggerAi && !aiVariations.some((v) => v.is_accepted) && aiJob?.status !== "failed" && (
        <div className="lg:w-[calc(100%+328px)] xl:w-[calc(100%+360px)]">
          {req.ai_generated
            ? <AiRegenerateButton requestId={req.id} currentTitle={req.title} currentDescription={req.description ?? ""} />
            : <AiGenerateButton requestId={req.id} />}
        </div>
      )}

      {/* AI: generation progress (visible to designer + super_admin) */}
      {req.ai_generated && aiJob && aiJob.status !== "completed" && aiJob.status !== "failed" && (isAssignedDesigner || isSuperAdmin) && (
        <AiGenerationStatus
          jobId={aiJob.id}
          initialStatus={aiJob.status}
          posterType={aiJob.poster_type}
        />
      )}

      {/* AI: failed — show error + regenerate button */}
      {req.ai_generated && aiJob?.status === "failed" && (isAssignedDesigner || isSuperAdmin) && (
        <div className="space-y-3 lg:w-[calc(100%+316px)] xl:w-[calc(100%+344px)]">
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
        <div className="lg:w-[calc(100%+328px)] xl:w-[calc(100%+360px)]">
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
        </div>
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
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:flex-nowrap sm:gap-3"
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
            Post to the school&apos;s social handles, then paste the live links here.
          </p>
          <PublishForm requestId={req.id} />
        </section>
      )}

      {role !== "decision_maker" && activity.length > 0 && (
        <section className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] ring-1 ring-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950 dark:text-zinc-50">
              Activity
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:bg-zinc-800 dark:text-zinc-400">
              {activity.length} events
            </span>
          </div>
          <ol className="mt-4 space-y-3 border-l border-slate-200 pl-5 dark:border-zinc-800">
            {activity.map((a) => {
              const actorName =
                (a.actor_id && activityActorById.get(a.actor_id)?.trim()) ||
                "A team member";
              return (
                <li key={a.id} className="relative rounded-xl bg-white/55 px-3 py-2.5 text-sm shadow-sm ring-1 ring-slate-100/80 dark:bg-zinc-950/40 dark:ring-zinc-800">
                  <span className="absolute -left-[1.62rem] top-4 flex h-3 w-3 items-center justify-center rounded-full bg-white ring-4 ring-white dark:bg-zinc-950 dark:ring-zinc-900">
                    <span className="h-2 w-2 rounded-full bg-violet-500" />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-slate-700 dark:text-zinc-300">
                      <span className="font-semibold text-slate-950 dark:text-zinc-50">
                      {actorName}
                      </span>{" "}
                      {ACTIVITY_VERB[a.type]}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDateTime(a.created_at)}
                    </p>
                  </div>
                  {a.feedback && (
                    <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs italic text-slate-600 dark:bg-zinc-900 dark:text-zinc-400">
                      &ldquo;{a.feedback}&rdquo;
                    </p>
                  )}
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

      <section className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 grid grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_18px_60px_rgba(15,23,42,0.18)] ring-1 ring-white/80 backdrop-blur-xl sm:grid-cols-4 lg:static lg:z-auto lg:flex lg:flex-wrap lg:items-center lg:gap-2 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-t lg:bg-transparent lg:p-0 lg:pt-6 lg:shadow-none lg:ring-0 dark:border-zinc-800 dark:bg-zinc-950/95 lg:dark:bg-transparent">
        {canEdit && (
          <Link
            href={`/requests/${req.id}/edit`}
            className="hidden min-h-10 w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:w-auto lg:inline-flex dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Edit
          </Link>
        )}
        {canSubmit && (
          <ToastForm action={submitDraft} success="Request submitted for approval">
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="min-h-10 w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 sm:w-auto dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
              pendingLabel="Submitting..."
            >
              Submit for approval
            </SubmitButton>
          </ToastForm>
        )}
        {canApprove && (
          <ToastForm action={approveRequest} success="Request approved">
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="min-h-10 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 sm:w-auto"
              pendingLabel="Approving..."
            >
              Approve
            </SubmitButton>
          </ToastForm>
        )}
        {canSendBack && (
          <ToastForm action={sendBackForChanges} success="Sent back for changes" className="w-full">
            <input type="hidden" name="id" value={req.id} />
            <textarea
              name="feedback"
              placeholder="What should be changed? (optional)"
              rows={2}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <SubmitButton
              className="mt-2 min-h-10 w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              pendingLabel="Sending back..."
            >
              Send back for changes
            </SubmitButton>
          </ToastForm>
        )}
        {canPickUp && (
          <ToastForm action={pickUpRequest} success="Request picked up" className="col-span-2 lg:col-span-1">
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="min-h-10 w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 sm:w-auto dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
              pendingLabel="Picking up..."
            >
              Pick this up
            </SubmitButton>
          </ToastForm>
        )}
        {canApproveDesign && (
          <ToastForm action={approveDesign} success="Design approved">
            <input type="hidden" name="id" value={req.id} />
            <SubmitButton
              className="min-h-10 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 sm:w-auto"
              pendingLabel="Approving..."
            >
              Approve design
            </SubmitButton>
          </ToastForm>
        )}
        {canRequestDesignChanges && (
          <ToastForm action={requestDesignChanges} success="Change request sent to the designer" className="w-full">
            <input type="hidden" name="id" value={req.id} />
            <textarea
              name="feedback"
              placeholder="What should the designer change? (optional)"
              rows={2}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <SubmitButton
              className="mt-2 min-h-10 w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              pendingLabel="Sending..."
            >
              Request changes
            </SubmitButton>
          </ToastForm>
        )}
        {canArchive && (
          <ConfirmForm
            action={archiveRequest}
            message="Archive this request? It will be moved to the archived section."
            className={canDelete ? "hidden lg:block" : "hidden lg:block lg:ml-auto"}
          >
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-200 lg:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 dark:focus:ring-zinc-800"
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
            className="hidden lg:block lg:ml-auto"
          >
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="min-h-10 w-full rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 lg:w-auto dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
            >
              Delete
            </button>
          </ConfirmForm>
        )}
      </section>
        </main>

        <aside className="hidden space-y-5 lg:sticky lg:top-3 lg:-mt-14 lg:block lg:translate-x-4 lg:self-start xl:translate-x-6">
          <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_24px_70px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur-xl xl:p-5 dark:border-zinc-800 dark:bg-zinc-900/85">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-zinc-50">
              Approval status
            </h2>
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
              <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                Current stage
              </p>
              <p className="mt-2 text-base font-semibold text-slate-950 dark:text-zinc-50">
                {currentStageText}
              </p>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-xl bg-violet-600 px-3 py-3 text-center text-sm font-semibold text-white shadow-[0_14px_30px_rgba(124,58,237,0.25)]">
                {canPickUp
                  ? "Ready for design"
                  : canApprove || canApproveDesign
                    ? "Needs approval"
                    : canUploadDesign
                      ? "Design in progress"
                      : statusLabel}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center text-sm font-semibold text-slate-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {designer?.full_name ? designer.full_name : "Unassigned"}
              </div>
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-slate-950 dark:text-zinc-50">
                Checklist
              </h3>
              <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-zinc-300">
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                    ✓
                  </span>
                  Goal and audience clear
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                    ✓
                  </span>
                  Deadline confirmed
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                    ✓
                  </span>
                  Required copy attached
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-white">
                    ✓
                  </span>
                  Assets ready
                </li>
              </ul>
            </div>
          </section>

          {role !== "decision_maker" && latestActivity && (
            <section className="rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/85">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-zinc-50">
                Latest activity
              </h2>
              <div className="mt-5 flex gap-3">
                <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-600">
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950 dark:text-zinc-50">
                      {ACTIVITY_VERB[latestActivity.type]}
                    </p>
                    <p className="shrink-0 text-xs text-slate-400">
                      {formatDateTime(latestActivity.created_at)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                    {latestActorName}
                    {latestActivity.feedback ? `: ${latestActivity.feedback}` : ""}
                  </p>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
