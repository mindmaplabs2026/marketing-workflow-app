import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type { RequestStatus } from "@/lib/supabase/types";
import { STATUS_SHORT, STATUS_BADGE_CLASS } from "./status";

type RequestListRow = {
  id: string;
  title: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  school_id: string;
  created_by: string;
  assigned_designer_id: string | null;
};

type SchoolLite = { id: string; name: string };
type ProfileLite = { id: string; full_name: string | null };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default async function RequestsListPage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { role } = session;
  const supabase = await createClient();

  const canRaise = role === "teacher" || role === "school_admin";
  const isReviewer = role === "school_admin" || role === "super_admin";
  const isDesigner = role === "designer" || role === "super_admin";

  const [requestsRes, schoolsRes] = await Promise.all([
    supabase
      .from("requests")
      .select(
        "id, title, status, created_at, updated_at, school_id, created_by, assigned_designer_id",
      )
      .order("created_at", { ascending: false })
      .returns<RequestListRow[]>(),
    supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<SchoolLite[]>(),
  ]);

  const requests = requestsRes.data ?? [];
  const schoolsById = new Map((schoolsRes.data ?? []).map((s) => [s.id, s.name]));

  const creatorIds = Array.from(new Set(requests.map((r) => r.created_by)));
  let creators: ProfileLite[] = [];
  if (creatorIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds)
      .returns<ProfileLite[]>();
    creators = data ?? [];
  }
  const creatorById = new Map(creators.map((p) => [p.id, p.full_name]));

  const needsYou: RequestListRow[] = [];
  const myDrafts: RequestListRow[] = [];
  const inFlight: RequestListRow[] = [];
  const published: RequestListRow[] = [];
  const archived: RequestListRow[] = [];

  for (const r of requests) {
    if (r.status === "archived") {
      archived.push(r);
      continue;
    }
    if (r.status === "published") {
      published.push(r);
      continue;
    }
    if (r.status === "draft") {
      if (r.created_by === session.id) myDrafts.push(r);
      else if (isReviewer) inFlight.push(r);
      continue;
    }

    let queued = false;
    if (isReviewer) {
      if (
        r.status === "pending_admin_approval" ||
        r.status === "design_pending_approval"
      ) {
        needsYou.push(r);
        queued = true;
      }
    }
    if (!queued && isDesigner) {
      const mine = r.assigned_designer_id === session.id;
      if (r.status === "approved") {
        needsYou.push(r);
        queued = true;
      } else if (
        mine &&
        (r.status === "in_design" || r.status === "changes_requested")
      ) {
        needsYou.push(r);
        queued = true;
      }
    }
    if (!queued) inFlight.push(r);
  }

  // School-admin snapshot: clarity-doc "glances at the analytics from their
  // last post." Scoped to whatever this user can already see (RLS-filtered).
  let snapshot: {
    publishedLast30: number;
    avgDaysToPublish: number | null;
    waitingOnYou: number;
  } | null = null;
  if (isReviewer) {
    const since30Ms = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentPublished = requests.filter(
      (r) =>
        r.status === "published" &&
        new Date(r.updated_at).getTime() >= since30Ms,
    );
    let avg: number | null = null;
    if (recentPublished.length > 0) {
      const sumDays = recentPublished.reduce((acc, r) => {
        const days =
          (new Date(r.updated_at).getTime() -
            new Date(r.created_at).getTime()) /
          (1000 * 60 * 60 * 24);
        return acc + Math.max(0, days);
      }, 0);
      avg = Math.round((sumDays / recentPublished.length) * 10) / 10;
    }
    const waiting = requests.filter(
      (r) =>
        r.status === "pending_admin_approval" ||
        r.status === "design_pending_approval",
    ).length;
    snapshot = {
      publishedLast30: recentPublished.length,
      avgDaysToPublish: avg,
      waitingOnYou: waiting,
    };
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Requests
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Everything in flight for your school.
          </p>
        </div>
        {canRaise && (
          <Link
            href="/requests/new"
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            + Raise
          </Link>
        )}
      </div>

      {requestsRes.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {requestsRes.error.message}
        </p>
      )}

      {snapshot && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Published (30d)" value={snapshot.publishedLast30} />
          <Stat
            label="Avg days to publish"
            value={
              snapshot.avgDaysToPublish === null
                ? "—"
                : snapshot.avgDaysToPublish
            }
          />
          <Stat
            label="Waiting on you"
            value={snapshot.waitingOnYou}
            urgent={snapshot.waitingOnYou > 0}
          />
        </div>
      )}

      <Section title="Needs you" items={needsYou} variant="urgent" />
      <Section title="My drafts" items={myDrafts} variant="muted" />
      <Section title="In flight" items={inFlight} />
      <Section title="Published" items={published} />
      <Section title="Archived" items={archived} variant="muted" />

      {requests.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path d="M9 4h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.6"/>
              <path d="M10 9h4M10 13h4M10 17h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {canRaise ? "Raise your first request." : "Nothing here yet."}
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {canRaise
              ? "Tap \"New request\" to send it over to the design team."
              : "Once your team raises requests, you'll see them here."}
          </p>
        </div>
      )}
    </div>
  );

  function Section({
    title,
    items,
    variant,
  }: {
    title: string;
    items: RequestListRow[];
    variant?: "urgent" | "muted";
  }) {
    if (items.length === 0) return null;
    return (
      <section className="space-y-2">
        <h2
          className={
            variant === "urgent"
              ? "text-sm font-medium text-amber-700 dark:text-amber-300"
              : variant === "muted"
                ? "text-xs font-medium uppercase tracking-widest text-zinc-500"
                : "text-sm font-medium text-zinc-700 dark:text-zinc-300"
          }
        >
          {title} ({items.length})
        </h2>
        <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {items.map((r) => {
            const creatorName =
              creatorById.get(r.created_by)?.trim() || "someone";
            const schoolName = schoolsById.get(r.school_id) ?? "";
            return (
              <li key={r.id}>
                <Link
                  href={`/requests/${r.id}`}
                  className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-violet-700"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {r.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {creatorName}
                      {schoolName ? ` · ${schoolName}` : ""} ·{" "}
                      {formatDate(r.created_at)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
                  >
                    {STATUS_SHORT[r.status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
}

function Stat({
  label,
  value,
  urgent,
}: {
  label: string;
  value: number | string;
  urgent?: boolean;
}) {
  return (
    <div
      className={
        urgent
          ? "rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20"
          : "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      }
    >
      <p
        className={
          urgent
            ? "text-3xl font-semibold text-amber-900 dark:text-amber-200"
            : "text-3xl font-semibold text-zinc-900 dark:text-zinc-50"
        }
      >
        {value}
      </p>
      <p
        className={
          urgent
            ? "mt-1 text-sm text-amber-800 dark:text-amber-300"
            : "mt-1 text-sm text-zinc-600 dark:text-zinc-400"
        }
      >
        {label}
      </p>
    </div>
  );
}
