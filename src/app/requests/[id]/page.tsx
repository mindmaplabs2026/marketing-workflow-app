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
  approveDesign,
  approveRequest,
  archiveRequest,
  pickUpRequest,
  removeDesign,
  removeUpload,
  requestDesignChanges,
  sendBackForChanges,
  submitDraft,
} from "../actions";
import { UploadDesignForm } from "./upload-design-form";
import { PublishForm } from "./publish-form";
import { ConfirmForm } from "@/components/confirm-form";

type RequestRow = {
  id: string;
  school_id: string;
  created_by: string;
  assigned_designer_id: string | null;
  approved_by: string | null;
  title: string;
  description: string | null;
  status: RequestStatus;
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

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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
      "id, school_id, created_by, assigned_designer_id, approved_by, title, description, status, created_at, updated_at",
    )
    .eq("id", id)
    .single<RequestRow>();
  if (!req) notFound();

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

  const isCreator = req.created_by === user.id;
  const isReviewer = role === "school_admin" || role === "super_admin";
  const isAssignedDesigner =
    (role === "designer" || role === "super_admin") &&
    req.assigned_designer_id === user.id;

  const canEdit = isCreator && req.status === "draft";
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
  const canPublish =
    isAssignedDesigner && req.status === "in_design" && designsList.length > 0;
  const canArchive =
    (isCreator || isReviewer) &&
    req.status !== "archived" &&
    req.status !== "published";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/requests"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All requests
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {req.title}
          </h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[req.status]}`}
          >
            {getStatusLabel(req.status, role, req)}
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

      {req.description && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          <p className="whitespace-pre-wrap">{req.description}</p>
        </div>
      )}

      {uploadsList.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            From the school ({uploadsList.length})
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {uploadsList.map((u) => {
              const url = signedUploadUrls.get(u.storage_path);
              const isImage = (u.mime_type ?? "").startsWith("image/");
              const isVideo = (u.mime_type ?? "").startsWith("video/");
              const name = u.storage_path.split("/").pop() ?? "file";
              const canDelete =
                u.uploaded_by === user.id || role === "super_admin";
              return (
                <li
                  key={u.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {url && isImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={name}
                      className="aspect-square w-full object-cover"
                    />
                  )}
                  {url && isVideo && (
                    <video
                      src={url}
                      controls
                      className="aspect-square w-full object-cover"
                    />
                  )}
                  {url && !isImage && !isVideo && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square w-full bg-zinc-100 p-3 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      Open file →
                    </a>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-800">
                    <span className="truncate" title={name}>
                      {formatBytes(u.file_size)}
                    </span>
                    {canDelete && (
                      <ConfirmForm action={removeUpload} message="Remove this file? This cannot be undone.">
                        <input type="hidden" name="upload_id" value={u.id} />
                        <input type="hidden" name="request_id" value={req.id} />
                        <input
                          type="hidden"
                          name="storage_path"
                          value={u.storage_path}
                        />
                        <button
                          type="submit"
                          className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Remove
                        </button>
                      </ConfirmForm>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {designsList.length > 0 && role !== "decision_maker" && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Designs ({designsList.length})
          </h2>
          <ul className="space-y-3">
            {designsList.map((d) => {
              const url = signedDesignUrls.get(d.storage_path);
              const name = d.storage_path.split("/").pop() ?? "design";
              const ext = name.toLowerCase();
              const isImage = /\.(png|jpg|jpeg|gif|webp|svg)$/.test(ext);
              const isVideo = /\.(mp4|mov|webm)$/.test(ext);
              const isPdf = ext.endsWith(".pdf");
              const canDelete =
                d.uploaded_by === user.id || role === "super_admin";
              return (
                <li
                  key={d.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      v{d.version}
                    </span>
                    <span className="text-zinc-500">
                      {formatDateTime(d.created_at)}
                    </span>
                    {canDelete && (
                      <ConfirmForm action={removeDesign} message="Remove this design version? This cannot be undone." className="ml-auto">
                        <input type="hidden" name="design_id" value={d.id} />
                        <input type="hidden" name="request_id" value={req.id} />
                        <input
                          type="hidden"
                          name="storage_path"
                          value={d.storage_path}
                        />
                        <button
                          type="submit"
                          className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Remove
                        </button>
                      </ConfirmForm>
                    )}
                  </div>
                  {url && isImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={name} className="w-full" />
                  )}
                  {url && isVideo && (
                    <video src={url} controls className="w-full" />
                  )}
                  {url && isPdf && (
                    <iframe
                      src={url}
                      className="h-96 w-full"
                      title={`Design v${d.version}`}
                    />
                  )}
                  {url && !isImage && !isVideo && !isPdf && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block bg-zinc-100 p-4 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      Open file →
                    </a>
                  )}
                  {d.notes && (
                    <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      {d.notes}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
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
          <UploadDesignForm requestId={req.id} />
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
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Submit for approval
            </button>
          </form>
        )}
        {canApprove && (
          <form action={approveRequest}>
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Approve
            </button>
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
            <button
              type="submit"
              className="mt-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Send back for changes
            </button>
          </form>
        )}
        {canPickUp && (
          <form action={pickUpRequest}>
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Pick this up
            </button>
          </form>
        )}
        {canApproveDesign && (
          <form action={approveDesign}>
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Approve design
            </button>
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
            <button
              type="submit"
              className="mt-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Request changes
            </button>
          </form>
        )}
        {canArchive && (
          <ConfirmForm action={archiveRequest} message="Archive this request? It will be moved to the archived section." className="ml-auto">
            <input type="hidden" name="id" value={req.id} />
            <button
              type="submit"
              className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
            >
              Archive
            </button>
          </ConfirmForm>
        )}
      </section>
    </div>
  );
}
