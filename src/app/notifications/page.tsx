import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NotificationType } from "@/lib/supabase/types";
import { markAllRead, openNotification } from "./actions";
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows, error } = await supabase
    .from("notifications")
    .select(
      "id, type, body, read_at, created_at, request_id, calendar_item_id, actor_id",
    )
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<NotificationRow[]>();

  const notifications = rows ?? [];

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

      {notifications.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Nothing yet.
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            When something needs your attention you will see it here.
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
