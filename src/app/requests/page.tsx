import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type { RequestStatus } from "@/lib/supabase/types";
import { STATUS_SHORT, STATUS_BADGE_CLASS } from "./status";
import { archiveRequest, deleteRequest } from "./actions";
import { ConfirmForm } from "@/components/confirm-form";
import { SearchInput } from "@/components/search-input";
import { SelectFilter } from "@/components/select-filter";
import { Pagination } from "@/components/pagination";
import { CollapsibleRows } from "@/components/collapsible-rows";
import { MotionSurface } from "@/components/premium-motion";
import { RequestRowActions } from "@/components/request-row-actions";
import { AnimatedNumber } from "@/components/animated-number";
import { OverviewRangeFilter } from "@/components/overview-range-filter";

const SECTION_PAGE_SIZE = 10;
const SECTION_COLLAPSED_ROWS = 3;

const SECTION_PAGE_KEYS = {
  needsYou: "needs-you-page",
  inFlight: "in-flight-page",
  published: "published-page",
  archived: "archived-page",
} as const;

type SectionKey = keyof typeof SECTION_PAGE_KEYS;
type OverviewRange = "all-time" | "this-week" | "last-week" | "last-30-days";

type RequestListRow = {
  id: string;
  title: string;
  status: RequestStatus;
  created_at: string;
  updated_at: string;
  due_date: string | null;
  school_id: string;
  created_by: string;
  assigned_designer_id: string | null;
};

type SchoolLite = { id: string; name: string };
type ProfileLite = { id: string; full_name: string | null };


const OVERVIEW_RANGE_OPTIONS: { value: OverviewRange; label: string }[] = [
  { value: "all-time", label: "All time" },
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "last-30-days", label: "Last 30 days" },
];

const ICON_CLASS: Record<"needs" | "design" | "review" | "published", string> = {
  needs: "bg-orange-50 text-white shadow-orange-100",
  design: "bg-blue-50 text-white shadow-blue-100",
  review: "bg-violet-50 text-white shadow-violet-100",
  published: "bg-emerald-50 text-white shadow-emerald-100",
};

const ICON_INNER_CLASS: Record<"needs" | "design" | "review" | "published", string> = {
  needs: "bg-gradient-to-br from-orange-400 to-orange-600 shadow-[0_10px_20px_rgba(249,115,22,0.32)]",
  design: "bg-gradient-to-br from-blue-400 to-blue-600 shadow-[0_10px_20px_rgba(37,99,235,0.30)]",
  review: "bg-gradient-to-br from-violet-400 to-violet-700 shadow-[0_10px_20px_rgba(124,58,237,0.30)]",
  published: "bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-[0_10px_20px_rgba(16,185,129,0.30)]",
};

function readPage(raw: string | undefined): number {
  const n = parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function paginate<T>(
  items: T[],
  page: number,
): { slice: T[]; safePage: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / SECTION_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * SECTION_PAGE_SIZE;
  return {
    slice: items.slice(start, start + SECTION_PAGE_SIZE),
    safePage,
    totalPages,
  };
}

function formatDateOnly(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00+05:30`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatIsoDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function relativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / (1000 * 60)));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function countByStatus(requests: RequestListRow[]) {
  return requests.reduce(
    (acc, request) => {
      acc[request.status] = (acc[request.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<RequestStatus, number>>,
  );
}

function dateOnlyToUtcMs(dateOnly: string): number {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function todayInKolkataUtcMs(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

function daysUntilDue(dueDate: string | null, todayUtcMs: number): number | null {
  if (!dueDate) return null;
  return Math.round((dateOnlyToUtcMs(dueDate) - todayUtcMs) / (24 * 60 * 60 * 1000));
}

function priorityScore(request: RequestListRow, todayUtcMs: number): number {
  if (request.status === "published" || request.status === "archived") return 0;

  const dueInDays = daysUntilDue(request.due_date, todayUtcMs);
  const ageDays = Math.floor((Date.now() - new Date(request.updated_at).getTime()) / (24 * 60 * 60 * 1000));

  let score = 0;
  if (dueInDays !== null) {
    if (dueInDays < 0) score += 120 + Math.min(Math.abs(dueInDays), 14);
    else if (dueInDays === 0) score += 110;
    else if (dueInDays <= 2) score += 90;
    else if (dueInDays <= 7) score += 55;
  }

  if (request.status === "pending_admin_approval") score += 35;
  else if (request.status === "design_pending_approval") score += 35;
  else if (request.status === "changes_requested") score += 30;
  else if (request.status === "approved") score += 25;
  else if (request.status === "in_design") score += 15;

  if (ageDays >= 5) score += 20;
  else if (ageDays >= 2) score += 10;

  return score;
}

function priorityReason(request: RequestListRow, todayUtcMs: number): string {
  const dueInDays = daysUntilDue(request.due_date, todayUtcMs);
  if (dueInDays !== null) {
    if (dueInDays < 0) return `${Math.abs(dueInDays)}d overdue`;
    if (dueInDays === 0) return "Due today";
    if (dueInDays === 1) return "Due tomorrow";
    if (dueInDays <= 7) return `Due in ${dueInDays}d`;
  }

  if (request.status === "changes_requested") return "Changes requested";
  if (request.status === "pending_admin_approval" || request.status === "design_pending_approval") return "Awaiting review";
  if (request.status === "approved") return "Ready for design";
  return "Active work";
}

function rowTimingLabel(request: RequestListRow, todayUtcMs: number): string {
  // Terminal states have no due date to track; show when they wrapped up.
  if (request.status === "published" || request.status === "archived") {
    return formatIsoDate(request.updated_at);
  }

  const dueInDays = daysUntilDue(request.due_date, todayUtcMs);
  if (dueInDays !== null) {
    if (dueInDays < 0) return `${Math.abs(dueInDays)}d overdue`;
    if (dueInDays === 0) return "Due today";
    if (dueInDays === 1) return "Due tomorrow";
    return `Due ${formatDateOnly(request.due_date!)}`;
  }
  // No due date set: fall back to the date the request was raised.
  return formatIsoDate(request.created_at);
}

function rowTimingDotClass(request: RequestListRow, todayUtcMs: number): string {
  if (request.status === "published") return "bg-emerald-500";
  if (request.status === "archived") return "bg-zinc-400";
  const dueInDays = daysUntilDue(request.due_date, todayUtcMs);
  return dueInDays !== null && dueInDays < 0 ? "bg-rose-500" : "bg-orange-500";
}

function normalizedOverviewRange(value: string | undefined): OverviewRange {
  return OVERVIEW_RANGE_OPTIONS.some((item) => item.value === value)
    ? (value as OverviewRange)
    : "all-time";
}

/** Parse a YYYY-MM-DD query value as a local date (midnight). */
function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

type OverviewRangeMeta = {
  label: string;
  comparisonLabel: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};

/**
 * Meta for `overview=custom&from=…&to=…`: the inclusive from→to window, compared
 * against the equal-length period immediately before it. Returns null unless both
 * dates are valid (so a malformed URL falls back to the preset ranges).
 */
function customOverviewRangeMeta(
  overview: string | undefined,
  fromParam: string | undefined,
  toParam: string | undefined,
): OverviewRangeMeta | null {
  if (overview !== "custom") return null;
  let from = parseDateOnly(fromParam);
  let to = parseDateOnly(toParam);
  if (!from || !to) return null;
  if (from > to) [from, to] = [to, from];
  const end = new Date(to);
  end.setDate(to.getDate() + 1); // end is exclusive
  const days = Math.round((end.getTime() - from.getTime()) / 86_400_000);
  const previousStart = new Date(from);
  previousStart.setDate(from.getDate() - days);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return {
    label: `${fmt(from)} – ${fmt(to)}`,
    comparisonLabel: `vs previous ${days} day${days === 1 ? "" : "s"}`,
    start: from,
    end,
    previousStart,
    previousEnd: from,
  };
}

function RequestIcon({ type, className }: { type: "needs" | "design" | "review" | "published"; className?: string }) {
  if (type === "needs") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M7 4h10M7 20h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M8 4c0 4 2.2 5.9 4 8-1.8 2.1-4 4-4 8M16 4c0 4-2.2 5.9-4 8 1.8 2.1 4 4 4 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 8h4M10 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "design") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5 16.5V19h2.5L18.2 8.3l-2.5-2.5L5 16.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14.6 6.9 17.1 9.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "review") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 20c.8-3.5 2.9-5.5 5-5.5s4.2 2 5 5.5M14.5 20c.5-2.2 1.8-3.6 3.2-3.6 1.3 0 2.5 1.2 3 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 12.5l4 4L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sparkline({
  color = "violet",
  extendRight = false,
}: {
  color?: "violet" | "orange" | "blue" | "emerald";
  extendRight?: boolean;
}) {
  const stroke = {
    violet: "#7c3aed",
    orange: "#f97316",
    blue: "#2563eb",
    emerald: "#10b981",
  }[color];
  const basePath = "M2 27C13 23 18 18 29 22C39 26 42 30 53 23C63 16 67 14 77 20C88 26 91 22 99 13C107 4 111 14 118 9";
  const linePath = extendRight
    ? `${basePath}C124 10 128 13 134 10C137 8 140 11 142 9`
    : basePath;
  const fillPath = `${linePath}V34H2V27Z`;

  return (
    <svg viewBox="0 0 120 34" fill="none" className="h-8 w-full overflow-visible">
      <path
        d={fillPath}
        fill={stroke}
        opacity="0.12"
      />
      <path
        d={linePath}
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MiniBars({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const maxValue = Math.max(1, ...data.map((bar) => bar.value));
  const activeIndex =
    data.length > 0
      ? data.reduce(
          (bestIndex, bar, index) =>
            bar.value > data[bestIndex].value ? index : bestIndex,
          0,
        )
      : 0;

  return (
    <div>
      <div className="flex h-20 items-end gap-2">
        {data.map((bar, index) => (
          <span
            key={bar.label}
            className={`w-full rounded-t-md ${
              index === activeIndex ? "bg-violet-600" : "bg-violet-100"
            }`}
            style={{ height: `${Math.max(8, Math.round((bar.value / maxValue) * 56))}px` }}
            title={`${bar.label}: ${bar.value} requests`}
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-medium text-slate-400">
        {data.map((bar) => (
          <span key={bar.label}>{bar.label}</span>
        ))}
      </div>
    </div>
  );
}

function Donut({ needs, inFlight, review, published }: { needs: number; inFlight: number; review: number; published: number }) {
  const total = Math.max(1, needs + inFlight + review + published);
  const needsDeg = (needs / total) * 360;
  const inFlightDeg = needsDeg + (inFlight / total) * 360;
  const reviewDeg = inFlightDeg + (review / total) * 360;
  return (
    <span
      className="relative inline-flex h-20 w-20 rounded-full"
      style={{
        background: `conic-gradient(#f97316 0deg ${needsDeg}deg, #2563eb ${needsDeg}deg ${inFlightDeg}deg, #7c3aed ${inFlightDeg}deg ${reviewDeg}deg, #10b981 ${reviewDeg}deg 360deg)`,
      }}
    >
      <span className="absolute inset-3 rounded-full bg-white" />
    </span>
  );
}

export default async function RequestsListPage({
  searchParams,
}: {
  searchParams: Promise<
    { school?: string; q?: string; overview?: string; from?: string; to?: string } & Partial<
      Record<(typeof SECTION_PAGE_KEYS)[SectionKey], string>
    >
  >;
}) {
  const params = await searchParams;
  const schoolFilter = params.school ?? "";
  const rawQuery = params.q ?? "";
  const searchQuery = rawQuery.trim().toLowerCase();
  const customOverviewMeta = customOverviewRangeMeta(params.overview, params.from, params.to);
  const overviewRange = normalizedOverviewRange(params.overview);

  const sectionPages: Record<SectionKey, number> = {
    needsYou: readPage(params[SECTION_PAGE_KEYS.needsYou]),
    inFlight: readPage(params[SECTION_PAGE_KEYS.inFlight]),
    published: readPage(params[SECTION_PAGE_KEYS.published]),
    archived: readPage(params[SECTION_PAGE_KEYS.archived]),
  };

  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { id: userId, role } = session;
  const supabase = await createClient();

  const canRaise = role === "teacher" || role === "school_admin";
  const isTeacher = role === "teacher";
  const isReviewer = role === "school_admin" || role === "super_admin";
  const isDesigner = role === "designer" || role === "super_admin";
  const isManagingAdmin = role === "super_admin" || role === "school_admin";

  function canEditRequest(request: RequestListRow): boolean {
    return (
      role === "super_admin" ||
      (request.created_by === userId && request.status === "draft") ||
      (isManagingAdmin &&
        (request.status === "draft" || request.status === "pending_admin_approval"))
    );
  }

  function canArchiveRequest(request: RequestListRow): boolean {
    return (
      (request.created_by === userId || isReviewer) &&
      request.status !== "archived" &&
      request.status !== "published"
    );
  }

  function canDeleteStatus(s: RequestStatus): boolean {
    if (role === "super_admin") return true;
    return s === "draft" || s === "pending_admin_approval";
  }

  const [requestsRes, schoolsRes] = await Promise.all([
    supabase
      .from("requests")
      .select(
        "id, title, status, created_at, updated_at, due_date, school_id, created_by, assigned_designer_id",
      )
      .order("updated_at", { ascending: false })
      .returns<RequestListRow[]>(),
    supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<SchoolLite[]>(),
  ]);

  const allRequests = requestsRes.data ?? [];
  const schoolsList = schoolsRes.data ?? [];
  const schoolsById = new Map(schoolsList.map((s) => [s.id, s.name]));

  const creatorIds = Array.from(new Set(allRequests.map((r) => r.created_by)));
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

  let requests = schoolFilter
    ? allRequests.filter((r) => r.school_id === schoolFilter)
    : allRequests;

  if (searchQuery) {
    requests = requests.filter((r) => {
      const schoolName = schoolsById.get(r.school_id) ?? "";
      const creatorName = creatorById.get(r.created_by) ?? "";
      return `${r.title} ${schoolName} ${creatorName}`
        .toLowerCase()
        .includes(searchQuery);
    });
  }

  // ── Global date-range filter ────────────────────────────────────────────
  // The overview range (presets or custom from/to) filters the WHOLE page —
  // tiles, section lists, high priority and the overview card — by created_at.
  // "All time" (the default) applies no date filter.
  const nowMs = Date.now();
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const dayIndex = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dayIndex);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const previousWeekStart = new Date(lastWeekStart);
  previousWeekStart.setDate(lastWeekStart.getDate() - 7);
  const last30Start = new Date(today);
  last30Start.setDate(today.getDate() - 29);
  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + 1);
  const previous30Start = new Date(last30Start);
  previous30Start.setDate(last30Start.getDate() - 30);
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const presetOverviewMeta: Record<Exclude<OverviewRange, "all-time">, OverviewRangeMeta> = {
    "this-week": {
      label: "This week",
      comparisonLabel: "vs last week",
      start: weekStart,
      end: weekEnd,
      previousStart: lastWeekStart,
      previousEnd: weekStart,
    },
    "last-week": {
      label: "Last week",
      comparisonLabel: "vs previous week",
      start: lastWeekStart,
      end: weekStart,
      previousStart: previousWeekStart,
      previousEnd: lastWeekStart,
    },
    "last-30-days": {
      label: "Last 30 days",
      comparisonLabel: "vs previous 30 days",
      start: last30Start,
      end: nextDay,
      previousStart: previous30Start,
      previousEnd: last30Start,
    },
  };
  const overviewRangeMeta: OverviewRangeMeta | null =
    customOverviewMeta ??
    (overviewRange === "all-time" ? null : presetOverviewMeta[overviewRange]);
  // Pre-range set: the comparison period lies OUTSIDE the selected range.
  const requestsAllTime = requests;
  if (overviewRangeMeta) {
    requests = requests.filter((request) => {
      const createdAt = new Date(request.created_at);
      return createdAt >= overviewRangeMeta.start && createdAt < overviewRangeMeta.end;
    });
  }

  const needsYou: RequestListRow[] = [];
  const inFlight: RequestListRow[] = [];
  const published: RequestListRow[] = [];
  const archived: RequestListRow[] = [];
  const myRequests = requests.filter((request) => request.created_by === userId);

  for (const request of requests) {
    if (request.status === "archived") {
      archived.push(request);
      continue;
    }
    if (request.status === "published") {
      published.push(request);
      continue;
    }

    const needsReviewer =
      isReviewer &&
      (request.status === "pending_admin_approval" ||
        request.status === "design_pending_approval");
    const needsDesigner = isDesigner && request.status === "approved";

    if (needsReviewer || needsDesigner) {
      needsYou.push(request);
      continue;
    }

    inFlight.push(request);
  }

  const statusCounts = countByStatus(requests);
  const inDesignCount =
    (statusCounts.approved ?? 0) +
    (statusCounts.in_design ?? 0) +
    (statusCounts.changes_requested ?? 0);
  const pendingReviewCount =
    (statusCounts.pending_admin_approval ?? 0) +
    (statusCounts.design_pending_approval ?? 0);
  // The page's `requests` set is already range-filtered above, so the overview
  // card simply reflects it. The comparison period comes from the PRE-range set.
  const overviewRequests = requests;
  const previousOverviewRequests = overviewRangeMeta
    ? requestsAllTime.filter((request) => {
        const createdAt = new Date(request.created_at);
        return createdAt >= overviewRangeMeta.previousStart && createdAt < overviewRangeMeta.previousEnd;
      })
    : [];
  const overviewWeekdayCounts = Array.from({ length: 7 }, () => 0);

  for (const request of overviewRequests) {
    const createdAt = new Date(request.created_at);
    overviewWeekdayCounts[(createdAt.getDay() + 6) % 7] += 1;
  }

  const overviewRequestBars = weekdayLabels.map((label, index) => ({
    label,
    value: overviewWeekdayCounts[index],
  }));
  const overviewStatusCounts = countByStatus(overviewRequests);
  const overviewNeedsCount =
    (overviewStatusCounts.pending_admin_approval ?? 0) +
    (overviewStatusCounts.approved ?? 0);
  const overviewInFlightCount =
    (overviewStatusCounts.in_design ?? 0) +
    (overviewStatusCounts.changes_requested ?? 0);
  const overviewReviewCount = overviewStatusCounts.design_pending_approval ?? 0;
  const overviewPublishedCount = overviewStatusCounts.published ?? 0;
  const overviewTotal = overviewRequests.length;
  const overviewPercent = (value: number) =>
    overviewTotal > 0 ? Math.round((value / overviewTotal) * 100) : 0;
  // Comparison vs the previous period — only meaningful when a range is active.
  const overviewChange = !overviewRangeMeta
    ? null
    : previousOverviewRequests.length > 0
      ? Math.round(((overviewTotal - previousOverviewRequests.length) / previousOverviewRequests.length) * 100)
      : overviewTotal > 0
        ? 100
        : 0;
  const overviewChangePrefix = (overviewChange ?? 0) >= 0 ? "+" : "-";
  const todayUtcMs = todayInKolkataUtcMs();
  const highPriority = requests
    .map((request) => ({
      request,
      score: priorityScore(request, todayUtcMs),
    }))
    .filter((item) => item.score >= 50)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDue = a.request.due_date ? dateOnlyToUtcMs(a.request.due_date) : Number.MAX_SAFE_INTEGER;
      const bDue = b.request.due_date ? dateOnlyToUtcMs(b.request.due_date) : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(a.request.updated_at).getTime() - new Date(b.request.updated_at).getTime();
    })
    .map((item) => item.request);
  const publishedLast30 = published.filter(
    (request) =>
      nowMs - new Date(request.updated_at).getTime() <= 30 * 24 * 60 * 60 * 1000,
  ).length;

  const needsYouView = paginate(needsYou, sectionPages.needsYou);
  const myRequestsView = paginate(myRequests, sectionPages.needsYou);
  const inFlightView = paginate(inFlight, sectionPages.inFlight);
  const publishedView = paginate(published, sectionPages.published);
  const archivedView = paginate(archived, sectionPages.archived);
  const needsSectionTitle = isTeacher ? "My requests" : "Needs you";
  const needsSectionCount = isTeacher ? myRequests.length : needsYou.length;
  const latestActivity = [...requests]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, 3);

  function withParams(next: Partial<Record<string, string>>) {
    const sp = new URLSearchParams();
    if (rawQuery) sp.set("q", rawQuery);
    if (schoolFilter) sp.set("school", schoolFilter);
    if (overviewRange !== "this-week") sp.set("overview", overviewRange);
    for (const [key, value] of Object.entries(next)) {
      if (value) sp.set(key, value);
      else sp.delete(key);
    }
    const qs = sp.toString();
    return qs ? `/requests?${qs}` : "/requests";
  }

  function sectionHref(target: SectionKey, page: number): string {
    return withParams({ [SECTION_PAGE_KEYS[target]]: page > 1 ? String(page) : "" });
  }

  function sectionPagination(key: SectionKey, totalItems: number) {
    return (
      <Pagination
        totalItems={totalItems}
        pageSize={SECTION_PAGE_SIZE}
        currentPage={sectionPages[key]}
        pageHref={(page) => sectionHref(key, page)}
      />
    );
  }

  const showSchoolFilter = isDesigner && schoolsList.length > 1;

  return (
    <div className="min-h-full overflow-x-hidden bg-[radial-gradient(circle_at_78%_4%,rgba(124,58,237,0.13),transparent_29%),radial-gradient(circle_at_18%_18%,rgba(14,165,233,0.08),transparent_25%),linear-gradient(180deg,#ffffff_0%,#fbfbff_48%,#f8fafc_100%)] px-3 pb-5 pt-0 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1360px] space-y-4">
        <section className="relative min-h-24 overflow-hidden pb-2 pt-2 sm:pt-3">
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] overflow-hidden lg:block">
            <div className="absolute left-2 top-12 h-16 w-[540px] -rotate-3 rounded-full bg-violet-100/55 blur-3xl" />
            <svg
              viewBox="0 0 600 120"
              fill="none"
              className="absolute left-9 top-7 h-28 w-[600px] animate-[request-wave-float_7s_ease-in-out_infinite] motion-reduce:animate-none"
              aria-hidden="true"
            >
              <path
                d="M70 40C138 43 190 58 252 44C318 29 374 20 446 29C511 37 552 27 592 10"
                stroke="url(#requestTrailD)"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.18"
              />
              <path
                d="M68 47C142 52 196 72 260 54C330 32 382 29 452 42C510 53 552 39 590 21"
                stroke="url(#requestTrailA)"
                strokeWidth="10"
                strokeLinecap="round"
                opacity="0.18"
              />
              <path
                d="M68 62C140 66 204 84 268 66C339 45 397 46 462 58C515 68 554 56 588 38"
                stroke="url(#requestTrailB)"
                strokeWidth="6"
                strokeLinecap="round"
                opacity="0.30"
              />
              <path
                d="M69 35C142 38 210 56 270 38C343 16 406 24 472 34C522 42 558 30 596 12"
                stroke="url(#requestTrailC)"
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.20"
              />
              <path
                d="M71 72C145 80 202 93 266 77C338 59 404 57 468 68C522 78 558 65 590 49"
                stroke="url(#requestTrailE)"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity="0.16"
              />
              <circle cx="202" cy="18" r="3.5" fill="#a78bfa" opacity="0.85" />
              <circle cx="318" cy="61" r="4" fill="#2563eb" opacity="0.85" />
              <circle cx="442" cy="23" r="3" fill="#c4b5fd" opacity="0.9" />
              <circle cx="92" cy="26" r="2.5" fill="#c4b5fd" opacity="0.85" />
              <circle cx="118" cy="77" r="2" fill="#ddd6fe" opacity="0.9" />
              <circle cx="252" cy="30" r="2" fill="#a78bfa" opacity="0.75" />
              <circle cx="548" cy="54" r="2.5" fill="#bfdbfe" opacity="0.75" />
              <circle cx="158" cy="43" r="2.2" fill="#8b5cf6" opacity="0.55" />
              <circle cx="286" cy="84" r="2" fill="#c4b5fd" opacity="0.75" />
              <circle cx="384" cy="75" r="2.5" fill="#7c3aed" opacity="0.45" />
              <circle cx="512" cy="18" r="2.2" fill="#a78bfa" opacity="0.65" />
              <defs>
                <linearGradient id="requestTrailD" x1="70" y1="40" x2="592" y2="10" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ddd6fe" stopOpacity="0" />
                  <stop offset="0.42" stopColor="#c4b5fd" />
                  <stop offset="1" stopColor="#dbeafe" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="requestTrailA" x1="68" y1="47" x2="590" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#8b5cf6" stopOpacity="0" />
                  <stop offset="0.35" stopColor="#8b5cf6" />
                  <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="requestTrailB" x1="68" y1="62" x2="588" y2="38" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#c4b5fd" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#7c3aed" />
                  <stop offset="1" stopColor="#93c5fd" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="requestTrailC" x1="69" y1="35" x2="596" y2="12" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ddd6fe" stopOpacity="0" />
                  <stop offset="0.48" stopColor="#a78bfa" />
                  <stop offset="1" stopColor="#bfdbfe" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="requestTrailE" x1="71" y1="72" x2="590" y2="49" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#ede9fe" stopOpacity="0" />
                  <stop offset="0.5" stopColor="#a78bfa" />
                  <stop offset="1" stopColor="#bfdbfe" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute left-14 top-6 h-16 w-20 rotate-12 animate-[request-card-float_6s_ease-in-out_infinite] overflow-hidden rounded-2xl border border-violet-100/90 bg-white shadow-[0_18px_38px_rgba(124,58,237,0.16)] ring-1 ring-white/80 motion-reduce:animate-none">
              <div className="h-3 rounded-t-2xl bg-violet-500" />
              <div className="flex items-center gap-1 px-3 pt-3">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-700" />
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              </div>
              <div className="px-2 pt-0.5">
                <Sparkline />
              </div>
            </div>
          </div>

          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-lg">
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.01em] text-slate-950 sm:text-[2.6rem]">Requests in motion</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
                Everything you need to plan, create and deliver impactful marketing.
              </p>
            </div>
            {canRaise && (
              <Link
                href="/requests/new"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-violet-500 to-violet-700 px-5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(124,58,237,0.28)] ring-1 ring-violet-400/40 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(124,58,237,0.34)] focus:outline-none focus:ring-4 focus:ring-violet-200 motion-reduce:transform-none"
              >
                <span className="text-lg leading-none">+</span>
                Raise request
              </Link>
            )}
          </div>

          {requestsRes.error && (
            <p className="relative z-10 mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {requestsRes.error.message}
            </p>
          )}
        </section>

        <section className="grid min-w-0 gap-6 xl:-mt-2 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <section className="grid min-w-0 grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
              <MetricCard
                label={isTeacher ? "My requests" : "Needs you"}
                value={isTeacher ? myRequests.length : needsYou.length}
                note={isTeacher ? "Created by you" : "Action required"}
                icon="needs"
                color="orange"
              />
              <MetricCard
                label="In design"
                value={inDesignCount}
                note="Across schools"
                icon="design"
                color="blue"
              />
              <MetricCard
                label="In review"
                value={pendingReviewCount}
                note="Awaiting feedback"
                icon="review"
                color="violet"
              />
              <MetricCard
                label="Published"
                value={overviewRangeMeta ? published.length : publishedLast30}
                note={overviewRangeMeta ? overviewRangeMeta.label : "Last 30 days"}
                icon="published"
                color="emerald"
              />
            </section>

            <Panel
              title="Request overview"
              action={<OverviewRangeFilter presets={OVERVIEW_RANGE_OPTIONS} defaultValue="all-time" />}
              className="md:hidden"
            >
              <p className="text-xs font-medium text-zinc-500">Total requests</p>
              <div className="mt-2 flex items-end gap-3">
                <p className="text-3xl font-semibold text-zinc-950">
                  <AnimatedNumber value={overviewTotal} />
                </p>
                {overviewChange !== null && overviewRangeMeta && (
                  <p className={`pb-1 text-xs font-semibold ${overviewChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {overviewChangePrefix}<AnimatedNumber value={Math.abs(overviewChange)} suffix="%" /> {overviewRangeMeta.comparisonLabel}
                  </p>
                )}
              </div>
              <div className="mt-5">
                <MiniBars data={overviewRequestBars} />
              </div>
              <div className="mt-5 flex items-center gap-4">
                <Donut
                  needs={overviewNeedsCount}
                  inFlight={overviewInFlightCount}
                  review={overviewReviewCount}
                  published={overviewPublishedCount}
                />
                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <Legend color="bg-orange-500" label={isTeacher ? "My requests" : "Needs you"} value={overviewPercent(overviewNeedsCount)} suffix="%" />
                  <Legend color="bg-blue-500" label="In flight" value={overviewPercent(overviewInFlightCount)} suffix="%" />
                  <Legend color="bg-violet-500" label="In review" value={overviewPercent(overviewReviewCount)} suffix="%" />
                  <Legend color="bg-emerald-500" label="Published" value={overviewPercent(overviewPublishedCount)} suffix="%" />
                </div>
              </div>
            </Panel>

            <div className="rounded-2xl border border-white/80 bg-white/86 p-3 shadow-[0_18px_45px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/70 backdrop-blur-xl">
              <div className={`grid gap-3 xl:items-end ${showSchoolFilter ? "xl:grid-cols-[minmax(0,1fr)_220px]" : "xl:grid-cols-1"}`}>
                <div className="min-w-0">
                  <SearchInput
                    initialValue={rawQuery}
                    placeholder={showSchoolFilter ? "Search by title, school or owner..." : "Search by title or owner..."}
                    resetParams={Object.values(SECTION_PAGE_KEYS)}
                  />
                </div>
                {showSchoolFilter ? (
                  <div className="min-w-0">
                    <label htmlFor="school-filter" className="mb-1.5 block text-xs font-semibold text-slate-500">
                      School
                    </label>
                    <SelectFilter
                      paramName="school"
                      ariaLabel="Filter by school"
                      options={schoolsList.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      allLabel="All schools"
                      resetParams={Object.values(SECTION_PAGE_KEYS)}
                    />
                  </div>
                ) : null}
              </div>
              {(rawQuery || schoolFilter) && (
                <div className="mt-2 flex justify-end">
                  <Link
                    href="/requests"
                    scroll={false}
                    className="rounded-full px-2 text-xs font-semibold text-violet-600 transition hover:text-violet-700"
                  >
                    Clear all
                  </Link>
                </div>
              )}
            </div>

            <RequestSection
              title={needsSectionTitle}
              count={needsSectionCount}
              items={isTeacher ? myRequestsView.slice : needsYouView.slice}
              tone="orange"
              pagination={sectionPagination("needsYou", needsSectionCount)}
            />
            <RequestSection
              title="In flight"
              count={inFlight.length}
              items={inFlightView.slice}
              tone="blue"
              pagination={sectionPagination("inFlight", inFlight.length)}
            />
            <RequestSection
              title="Published"
              count={published.length}
              items={publishedView.slice}
              tone="emerald"
              pagination={sectionPagination("published", published.length)}
            />
            <RequestSection
              title="Archived"
              count={archived.length}
              items={archivedView.slice}
              tone="zinc"
              pagination={sectionPagination("archived", archived.length)}
            />

            {requests.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 p-10 text-center shadow-[0_18px_60px_rgba(15,23,42,0.06)] backdrop-blur">
                <p className="text-sm font-semibold text-slate-950">
                  {canRaise ? "Raise your first request." : "Nothing here yet."}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {canRaise
                    ? "Tap Raise request to send a brief to the design team."
                    : "Once your team raises requests, they will appear here."}
                </p>
              </div>
            )}

          </div>

          <aside className="min-w-0 space-y-4 xl:-mt-8">
            <Panel
              title="Request overview"
              action={<OverviewRangeFilter presets={OVERVIEW_RANGE_OPTIONS} defaultValue="all-time" />}
              className="hidden md:block"
            >
              <p className="text-xs font-medium text-zinc-500">Total requests</p>
              <div className="mt-2 flex items-end gap-3">
                <p className="text-3xl font-semibold text-zinc-950">
                  <AnimatedNumber value={overviewTotal} />
                </p>
                {overviewChange !== null && overviewRangeMeta && (
                  <p className={`pb-1 text-xs font-semibold ${overviewChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {overviewChangePrefix}<AnimatedNumber value={Math.abs(overviewChange)} suffix="%" /> {overviewRangeMeta.comparisonLabel}
                  </p>
                )}
              </div>
              <div className="mt-5">
                <MiniBars data={overviewRequestBars} />
              </div>
              <div className="mt-5 flex items-center gap-4">
                <Donut
                  needs={overviewNeedsCount}
                  inFlight={overviewInFlightCount}
                  review={overviewReviewCount}
                  published={overviewPublishedCount}
                />
                <div className="min-w-0 flex-1 space-y-2 text-xs">
                  <Legend color="bg-orange-500" label="Needs you" value={overviewPercent(overviewNeedsCount)} suffix="%" />
                  <Legend color="bg-blue-500" label="In flight" value={overviewPercent(overviewInFlightCount)} suffix="%" />
                  <Legend color="bg-violet-500" label="In review" value={overviewPercent(overviewReviewCount)} suffix="%" />
                  <Legend color="bg-emerald-500" label="Published" value={overviewPercent(overviewPublishedCount)} suffix="%" />
                </div>
              </div>
            </Panel>

            <Panel title="High priority" badge={String(highPriority.length)}>
              <div className="space-y-3">
                {highPriority.slice(0, 3).map((request) => (
                  <Link
                    key={request.id}
                    href={`/requests/${request.id}`}
                    className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-zinc-50"
                  >
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-semibold text-violet-600">
                      {(schoolsById.get(request.school_id) ?? "S").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-zinc-950">
                        {request.title}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {schoolsById.get(request.school_id) ?? "School"} - {STATUS_SHORT[request.status]}
                      </span>
                    </span>
                    <span className="text-[11px] font-semibold text-orange-600">
                      {priorityReason(request, todayUtcMs)}
                    </span>
                  </Link>
                ))}
                {highPriority.length === 0 && (
                  <p className="rounded-xl bg-zinc-50 px-3 py-4 text-center text-sm text-zinc-500">
                    No urgent requests right now.
                  </p>
                )}
              </div>
              <Link
                href="/requests"
                className="mt-4 flex h-9 items-center justify-center rounded-xl bg-violet-50 text-sm font-semibold text-violet-600 transition hover:bg-violet-100"
              >
                View all requests →
              </Link>
            </Panel>

            <Panel title="Latest activity">
              <div className="space-y-3">
                {latestActivity.map((request) => (
                  <Link
                    key={request.id}
                    href={`/requests/${request.id}`}
                    className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-zinc-50"
                  >
                    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${activityIconClass(request.status)}`}>
                      <RequestIcon type={activityIconType(request.status)} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-zinc-950">
                        {STATUS_SHORT[request.status]}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">
                        {request.title}
                      </span>
                    </span>
                    <span className="text-[11px] text-zinc-400">
                      {relativeAge(request.updated_at)}
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                href="/notifications"
                className="mt-4 flex h-9 items-center justify-center rounded-xl bg-violet-50 text-sm font-semibold text-violet-600 transition hover:bg-violet-100"
              >
                View all activity →
              </Link>
            </Panel>
          </aside>
        </section>
      </div>
    </div>
  );

  function RequestSection({
    title,
    count,
    items,
    tone,
    pagination,
  }: {
    title: string;
    count: number;
    items: RequestListRow[];
    tone: "orange" | "blue" | "emerald" | "zinc";
    pagination: React.ReactNode;
  }) {
    if (count === 0) return null;
    const titleClass = {
      orange: "text-orange-600",
      blue: "text-blue-600",
      emerald: "text-emerald-600",
      zinc: "text-zinc-500",
    }[tone];

    return (
      <section className="space-y-2">
        <h2 className={`flex items-center gap-1.5 text-sm font-semibold ${titleClass}`}>
          {title} ({count}) <span className="text-xs opacity-70">⌄</span>
        </h2>
        <CollapsibleRows
          collapsedCount={SECTION_COLLAPSED_ROWS}
          className="overflow-visible rounded-2xl border border-white/70 bg-white/82 shadow-[0_18px_60px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl"
        >
          {items.map((request) => {
            const schoolName = schoolsById.get(request.school_id) ?? "School";
            const showEdit = canEditRequest(request);
            const showArchive = canArchiveRequest(request);
            const showDelete = isManagingAdmin && canDeleteStatus(request.status);
            const showActions = showEdit || showArchive || showDelete;
            return (
              <div
                key={request.id}
                className="group relative flex items-center gap-2 border-b border-slate-100/90 px-4 py-3.5 last:border-b-0 transition duration-200 hover:bg-white hover:shadow-[inset_3px_0_0_rgba(124,58,237,0.22)]"
              >
                <Link href={`/requests/${request.id}`} className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[auto_minmax(0,1fr)_124px_54px]">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-lg transition duration-200 group-hover:scale-105 motion-reduce:transform-none ${rowIconClass(request.status)}`}>
                    <RequestIcon type={activityIconType(request.status)} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold tracking-[-0.005em] text-slate-950">
                      {request.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-slate-500">
                      {schoolName}
                    </span>
                  </span>
                  <span className={`hidden min-w-[92px] justify-center whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ring-1 ring-white/70 sm:inline-flex lg:justify-self-end ${STATUS_BADGE_CLASS[request.status]}`}>
                    {STATUS_SHORT[request.status]}
                  </span>
                  <span className="hidden items-center gap-2 whitespace-nowrap text-xs font-medium text-slate-500 md:flex lg:justify-self-end">
                    <span className={`h-1.5 w-1.5 rounded-full ${rowTimingDotClass(request, todayUtcMs)}`} />
                    {rowTimingLabel(request, todayUtcMs)}
                  </span>
                </Link>
                {showActions && (
                  <span className="flex w-9 shrink-0 justify-end">
                    <RequestRowActions label={`Actions for ${request.title}`}>
                      {showEdit && (
                        <Link
                          href={`/requests/${request.id}/edit`}
                          className="block px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Edit
                        </Link>
                      )}
                      {showArchive && (
                        <ConfirmForm
                          action={archiveRequest}
                          message="Archive this request? It will be moved to the archived section."
                        >
                          <input type="hidden" name="id" value={request.id} />
                          <button
                            type="submit"
                            className="block w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Archive
                          </button>
                        </ConfirmForm>
                      )}
                      {showDelete && (
                        <ConfirmForm
                          action={deleteRequest}
                          title="Delete request?"
                          message={`Permanently delete "${request.title}"? Attachments are removed too. Use Archive to keep a record.`}
                          confirmLabel="Delete"
                        >
                          <input type="hidden" name="id" value={request.id} />
                          <button
                            type="submit"
                            className="block w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                          >
                            Delete
                          </button>
                        </ConfirmForm>
                      )}
                    </RequestRowActions>
                  </span>
                )}
              </div>
            );
          })}
        </CollapsibleRows>
        {pagination}
      </section>
    );
  }
}

function MetricCard({
  label,
  value,
  note,
  icon,
  color,
}: {
  label: string;
  value: number;
  note: string;
  icon: "needs" | "design" | "review" | "published";
  color: "orange" | "blue" | "violet" | "emerald";
}) {
  const sparklineClass = "-ml-3.5 w-[calc(100%+0.875rem)]";

  return (
    <MotionSurface className="group relative grid h-32 min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(248,250,252,0.82))] p-3.5 shadow-[0_18px_55px_rgba(15,23,42,0.09)] ring-1 ring-slate-200/70 backdrop-blur-xl transition duration-300">
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent" />
      <span className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-violet-100/45 blur-2xl transition group-hover:bg-violet-200/50" />
      <div className="relative flex items-start gap-3">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg ring-1 ring-white/70 transition duration-300 group-hover:scale-105 motion-reduce:transform-none ${ICON_CLASS[icon]}`}>
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-xl ${ICON_INNER_CLASS[icon]}`}>
            <RequestIcon type={icon} className="h-4.5 w-4.5" />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block text-2xl font-semibold leading-none tracking-[-0.02em] text-slate-950">
            <AnimatedNumber value={value} />
          </span>
          <span className="mt-1.5 block whitespace-nowrap text-[14px] font-semibold leading-none text-slate-900">
            {label}
          </span>
          <span
            className={`mt-1 block text-[10px] font-medium leading-none ${
              color === "orange"
                ? "text-orange-600"
                : color === "blue"
                  ? "text-blue-600"
                  : color === "emerald"
                    ? "text-emerald-600"
                    : "text-violet-600"
            }`}
          >
            {note}
          </span>
        </span>
      </div>
      <div className={`relative flex items-end ${sparklineClass}`}>
        <Sparkline color={color} extendRight />
      </div>
    </MotionSurface>
  );
}

function Panel({
  title,
  children,
  action,
  badge,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  badge?: string;
  className?: string;
}) {
  return (
    <MotionSurface className={`rounded-2xl border border-white/75 bg-white/82 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70 backdrop-blur-xl ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-[-0.005em] text-slate-950">
          {title}
          {badge && (
            <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-600 ring-1 ring-violet-200/60">
              {badge}
            </span>
          )}
        </h2>
        {action && (
          <span className="inline-flex">
            {action}
          </span>
        )}
      </div>
      {children}
    </MotionSurface>
  );
}

function Legend({ color, label, value, suffix = "" }: { color: string; label: string; value: number; suffix?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="truncate text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">
        <AnimatedNumber value={value} suffix={suffix} />
      </span>
    </div>
  );
}

function rowIconClass(status: RequestStatus): string {
  if (status === "published") return "bg-gradient-to-br from-emerald-50 to-teal-100 text-emerald-600 shadow-emerald-100";
  if (status === "archived") return "bg-gradient-to-br from-slate-50 to-slate-100 text-slate-500 shadow-slate-100";
  if (status === "in_design" || status === "approved") return "bg-gradient-to-br from-blue-50 to-sky-100 text-blue-600 shadow-blue-100";
  if (status === "design_pending_approval") return "bg-gradient-to-br from-violet-50 to-purple-100 text-violet-600 shadow-violet-100";
  return "bg-gradient-to-br from-orange-50 to-amber-100 text-orange-600 shadow-orange-100";
}

function activityIconClass(status: RequestStatus): string {
  if (status === "published") return "bg-gradient-to-br from-emerald-50 to-teal-100 text-emerald-600 shadow-sm shadow-emerald-100";
  if (status === "in_design" || status === "approved") return "bg-gradient-to-br from-blue-50 to-sky-100 text-blue-600 shadow-sm shadow-blue-100";
  if (status === "design_pending_approval") return "bg-gradient-to-br from-violet-50 to-purple-100 text-violet-600 shadow-sm shadow-violet-100";
  return "bg-gradient-to-br from-orange-50 to-amber-100 text-orange-600 shadow-sm shadow-orange-100";
}

function activityIconType(status: RequestStatus): "needs" | "design" | "review" | "published" {
  if (status === "published") return "published";
  if (status === "in_design" || status === "approved") return "design";
  if (status === "design_pending_approval") return "review";
  return "needs";
}
