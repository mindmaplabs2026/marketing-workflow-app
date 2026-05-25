import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { RequestStatus } from "@/lib/supabase/types";
import { STATUS_BADGE_CLASS } from "@/app/requests/status";

type RequestRow = {
  id: string;
  title: string;
  status: RequestStatus;
  school_id: string;
  created_at: string;
  updated_at: string;
  assigned_designer_id: string | null;
  created_by: string;
};

type SchoolLite = { id: string; name: string };
type ProfileLite = { id: string; full_name: string | null };

const COLUMNS: Array<{
  key: string;
  label: string;
  statuses: RequestStatus[];
  tone: "amber" | "sky" | "indigo" | "emerald";
}> = [
  {
    key: "pending",
    label: "Pending approval",
    statuses: ["pending_admin_approval"],
    tone: "amber",
  },
  {
    key: "queued",
    label: "Queued for designer",
    statuses: ["approved"],
    tone: "sky",
  },
  {
    key: "in_design",
    label: "In design",
    statuses: ["in_design", "changes_requested"],
    tone: "indigo",
  },
  {
    key: "review",
    label: "Awaiting design review",
    statuses: ["design_pending_approval"],
    tone: "amber",
  },
  {
    key: "published",
    label: "Published (30d)",
    statuses: ["published"],
    tone: "emerald",
  },
];

const TONE_HEADER: Record<"amber" | "sky" | "indigo" | "emerald", string> = {
  amber:
    "border-amber-200 bg-amber-50/60 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200",
  sky: "border-sky-200 bg-sky-50/60 text-sky-900 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-200",
  indigo:
    "border-indigo-200 bg-indigo-50/60 text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-900/20 dark:text-indigo-200",
  emerald:
    "border-emerald-200 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200",
};

const STALE_DAY_THRESHOLD = 5;

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function ageLabel(updatedAt: string): { text: string; stale: boolean } {
  const days = daysBetween(updatedAt, new Date().toISOString());
  const stale = days >= STALE_DAY_THRESHOLD;
  if (days === 0) return { text: "today", stale: false };
  if (days === 1) return { text: "1d", stale };
  return { text: `${days}d`, stale };
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string }>;
}) {
  const params = await searchParams;
  const schoolFilter = params.school?.trim() || "";

  const supabase = await createClient();

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const schoolsRes = await supabase
    .from("schools")
    .select("id, name")
    .order("name", { ascending: true })
    .returns<SchoolLite[]>();
  const schools = schoolsRes.data ?? [];

  let requestsQuery = supabase
    .from("requests")
    .select(
      "id, title, status, school_id, created_at, updated_at, assigned_designer_id, created_by",
    )
    .neq("status", "archived")
    .neq("status", "draft")
    .order("updated_at", { ascending: true });
  if (schoolFilter) {
    requestsQuery = requestsQuery.eq("school_id", schoolFilter);
  }
  const requestsRes = await requestsQuery.returns<RequestRow[]>();
  const allRequests = requestsRes.data ?? [];

  // Drop published rows older than 30 days from the kanban so the column
  // doesn't grow forever. (We still query them for the avg-days metric.)
  const requestsForBoard = allRequests.filter(
    (r) => r.status !== "published" || r.updated_at >= since30,
  );

  // Per-column groupings
  const grouped = new Map<string, RequestRow[]>();
  for (const col of COLUMNS) grouped.set(col.key, []);
  for (const r of requestsForBoard) {
    const col = COLUMNS.find((c) => c.statuses.includes(r.status));
    if (!col) continue;
    grouped.get(col.key)!.push(r);
  }

  // Metrics
  const inFlight = requestsForBoard.filter(
    (r) => r.status !== "published",
  ).length;
  const publishedLast30 = allRequests.filter(
    (r) => r.status === "published" && r.updated_at >= since30,
  );
  let avgDaysToPublish: number | null = null;
  if (publishedLast30.length > 0) {
    const total = publishedLast30.reduce(
      (acc, r) => acc + daysBetween(r.created_at, r.updated_at),
      0,
    );
    avgDaysToPublish = Math.round((total / publishedLast30.length) * 10) / 10;
  }

  const schoolsById = new Map(schools.map((s) => [s.id, s.name]));

  // Look up creator + assigned designer names for the cards.
  const profileIds = Array.from(
    new Set(
      requestsForBoard
        .flatMap((r) => [r.created_by, r.assigned_designer_id])
        .filter((x): x is string => !!x),
    ),
  );
  let profiles: ProfileLite[] = [];
  if (profileIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", profileIds)
      .returns<ProfileLite[]>();
    profiles = data ?? [];
  }
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Pipeline
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Every request across every school, grouped by where it&apos;s stuck.
          </p>
        </div>
        <form className="flex items-center gap-2">
          <label
            htmlFor="school"
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            School
          </label>
          <select
            id="school"
            name="school"
            defaultValue={schoolFilter}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">All schools</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            Filter
          </button>
          {schoolFilter && (
            <Link
              href="/admin/pipeline"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric label="In flight" value={inFlight} />
        <Metric label="Published (30d)" value={publishedLast30.length} />
        <Metric
          label="Avg days to publish"
          value={avgDaysToPublish === null ? "—" : avgDaysToPublish}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.key) ?? [];
          return (
            <section
              key={col.key}
              className="flex flex-col rounded-lg border border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40"
            >
              <header
                className={`rounded-t-lg border-b px-3 py-2 text-xs font-semibold uppercase tracking-wider ${TONE_HEADER[col.tone]}`}
              >
                {col.label} ({items.length})
              </header>
              <ul className="flex-1 space-y-2 p-2">
                {items.map((r) => {
                  const age = ageLabel(r.updated_at);
                  const designerName =
                    (r.assigned_designer_id &&
                      nameById.get(r.assigned_designer_id)?.trim()) ||
                    null;
                  const schoolName = schoolsById.get(r.school_id) ?? "";
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/requests/${r.id}`}
                        className="block rounded-md border border-zinc-200 bg-white p-2 text-xs transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                      >
                        <p className="truncate font-medium text-zinc-900 dark:text-zinc-50">
                          {r.title}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-zinc-500">
                          {schoolName}
                          {designerName ? ` · ${designerName}` : ""}
                        </p>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
                          >
                            {r.status.replace(/_/g, " ")}
                          </span>
                          <span
                            className={
                              age.stale
                                ? "rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                                : "text-[10px] text-zinc-500"
                            }
                          >
                            {age.text}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {items.length === 0 && (
                  <li className="rounded-md border border-dashed border-zinc-300 bg-transparent p-3 text-center text-[10px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
                    All clear
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      {requestsRes.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {requestsRes.error.message}
        </p>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{label}</p>
    </div>
  );
}
