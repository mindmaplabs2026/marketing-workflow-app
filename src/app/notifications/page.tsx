import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type {
  NotificationEmailPref,
  NotificationType,
  RequestStatus,
} from "@/lib/supabase/types";
import {
  batchAct,
  markAllRead,
  openNotification,
  setEmailPref,
} from "./actions";
import { PushToggle } from "./push-toggle";

type NotificationRow = {
  id: string;
  type: NotificationType;
  body: string;
  read_at: string | null;
  created_at: string;
  request_id: string | null;
  calendar_item_id: string | null;
  actor_id: string | null;
};

type ProfileLite = { id: string; full_name: string | null };

const TYPE_ICON: Record<NotificationType, string> = {
  request_submitted_for_approval: "•",
  request_approved: "✓",
  request_sent_back_to_draft: "↩",
  design_uploaded_for_review: "•",
  design_approved: "✓",
  design_changes_requested: "↩",
  request_published: "★",
  calendar_item_approved: "✓",
};

const TYPE_TINT: Record<NotificationType, string> = {
  request_submitted_for_approval: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  request_approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  request_sent_back_to_draft: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300",
  design_uploaded_for_review: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  design_approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  design_changes_requested: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300",
  request_published: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300",
  calendar_item_approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default async function NotificationsPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { id: userId, role } = session;
  const supabase = await createClient();

  const [{ data: rows, error }, prefRes] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        "id, type, body, read_at, created_at, request_id, calendar_item_id, actor_id",
      )
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<NotificationRow[]>(),
    supabase
      .from("profiles")
      .select("email_pref")
      .eq("id", userId)
      .single<{ email_pref: NotificationEmailPref }>(),
  ]);
  const emailPref: NotificationEmailPref = prefRes.data?.email_pref ?? "daily";
  const isReviewer = role === "school_admin" || role === "super_admin";

  const notifications = rows ?? [];

  // For reviewers, surface a "Pending your approval" batch section. We need
  // the live status of each linked request so we don't show a stale row that
  // someone else already approved.
  type PendingRow = NotificationRow & { request_status: RequestStatus };
  let pendingApprovals: PendingRow[] = [];
  if (isReviewer) {
    const candidates = notifications.filter(
      (n) =>
        !n.read_at &&
        n.request_id &&
        (n.type === "request_submitted_for_approval" ||
          n.type === "design_uploaded_for_review"),
    );
    if (candidates.length > 0) {
      const reqIds = Array.from(
        new Set(candidates.map((c) => c.request_id!).filter(Boolean)),
      );
      const { data: reqs } = await supabase
        .from("requests")
        .select("id, status")
        .in("id", reqIds)
        .returns<{ id: string; status: RequestStatus }[]>();
      const statusById = new Map((reqs ?? []).map((r) => [r.id, r.status]));
      pendingApprovals = candidates
        .map((c) => ({
          ...c,
          request_status: statusById.get(c.request_id!) as RequestStatus,
        }))
        .filter(
          (c) =>
            (c.type === "request_submitted_for_approval" &&
              c.request_status === "pending_admin_approval") ||
            (c.type === "design_uploaded_for_review" &&
              c.request_status === "design_pending_approval"),
        );
    }
  }

  const actorIds = Array.from(
    new Set(notifications.map((n) => n.actor_id).filter((x): x is string => !!x)),
  );
  let actors: ProfileLite[] = [];
  if (actorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", actorIds)
      .returns<ProfileLite[]>();
    actors = data ?? [];
  }
  const actorById = new Map(actors.map((p) => [p.id, p.full_name]));

  const unread = notifications.filter((n) => !n.read_at);
  const read = notifications.filter((n) => n.read_at);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {unread.length > 0
              ? `${unread.length} unread`
              : "You are all caught up."}
          </p>
        </div>
        {unread.length > 0 && (
          <form action={markAllRead}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error.message}
        </p>
      )}

      <PushToggle
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      />

      <EmailPrefCard current={emailPref} />

      {pendingApprovals.length > 0 && (
        <PendingApprovalsForm items={pendingApprovals} actorById={actorById} />
      )}

      {notifications.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            All quiet.
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            When something needs you, it'll pop up here.
          </p>
        </div>
      )}

      <NotificationList
        title="Unread"
        items={unread}
        actorById={actorById}
        emphasize
      />
      <NotificationList
        title="Earlier"
        items={read}
        actorById={actorById}
      />
    </div>
  );
}

function PendingApprovalsForm({
  items,
  actorById,
}: {
  items: NotificationRow[];
  actorById: Map<string, string | null>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-amber-700 dark:text-amber-300">
        Pending your approval ({items.length})
      </h2>
      <form
        action={batchAct}
        className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      >
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {items.map((n) => {
            const actorName =
              (n.actor_id && actorById.get(n.actor_id)?.trim()) || "Someone";
            const kind =
              n.type === "request_submitted_for_approval" ? "Request" : "Design";
            return (
              <li key={n.id}>
                <label className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    name="notification_id"
                    value={n.id}
                    defaultChecked
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {n.body}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {kind} · {actorName}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            type="submit"
            name="action"
            value="approve"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            Approve selected
          </button>
          <button
            type="submit"
            name="action"
            value="send_back"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Send back selected
          </button>
          <span className="ml-auto text-[10px] text-zinc-500">
            Designs go back as &quot;changes requested&quot;
          </span>
        </div>
      </form>
    </section>
  );
}

function EmailPrefCard({ current }: { current: NotificationEmailPref }) {
  const options: { value: NotificationEmailPref; label: string; sub: string }[] =
    [
      { value: "daily", label: "Daily digest", sub: "One email per morning, what's waiting." },
      { value: "immediate", label: "Immediate", sub: "Every event also pings your inbox." },
      { value: "off", label: "Off", sub: "Push + the app only." },
    ];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Email backup
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Push only fires while a device is awake. Email is the safety net.
      </p>
      <form action={setEmailPref} className="mt-3 space-y-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
              current === opt.value
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-800"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
            }`}
          >
            <input
              type="radio"
              name="pref"
              value={opt.value}
              defaultChecked={current === opt.value}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-zinc-900 dark:text-zinc-50">
                {opt.label}
              </span>
              <span className="block text-xs text-zinc-500">{opt.sub}</span>
            </span>
          </label>
        ))}
        <button
          type="submit"
          className="mt-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
        >
          Save
        </button>
      </form>
    </div>
  );
}

function NotificationList({
  title,
  items,
  actorById,
  emphasize,
}: {
  title: string;
  items: NotificationRow[];
  actorById: Map<string, string | null>;
  emphasize?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2
        className={
          emphasize
            ? "text-sm font-medium text-amber-700 dark:text-amber-300"
            : "text-xs font-medium uppercase tracking-widest text-zinc-500"
        }
      >
        {title} ({items.length})
      </h2>
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {items.map((n) => {
          const actorName =
            (n.actor_id && actorById.get(n.actor_id)?.trim()) || "Someone";
          return (
            <li key={n.id}>
              <form action={openNotification}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                    n.read_at ? "" : "bg-amber-50/40 dark:bg-amber-900/10"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${TYPE_TINT[n.type]}`}
                  >
                    {TYPE_ICON[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {n.body}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {actorName} · {formatRelative(n.created_at)}
                    </p>
                  </div>
                  {!n.read_at && (
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  )}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
