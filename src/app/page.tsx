import Link from "next/link";
import { getSessionUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { SuccessToast } from "@/components/success-toast";
import { AnimatedNumber } from "@/components/animated-number";
import { STATUS_BADGE_CLASS, STATUS_SHORT } from "@/app/requests/status";
import type { RequestStatus, UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const ROLE_NEXT_STEP: Record<UserRole, string> = {
  super_admin: "Manage schools and users, or jump into the request board.",
  designer: "Pick up approved requests, design, publish - all from the queue.",
  school_admin: "Raise new requests, approve drafts, and track what's in flight.",
  teacher: "Raise a request - your school admin gives the OK.",
  decision_maker:
    "See the month's plan and every post that's gone live for your school.",
};

type ShortcutCard = {
  href: string;
  title: string;
  body: string;
  icon: "requests" | "calendar" | "published" | "agency";
  emphasis?: boolean;
};

type RequestRow = {
  id: string;
  title: string;
  status: RequestStatus;
  updated_at: string;
  created_at: string;
  school_id: string;
};

type CalendarRow = {
  id: string;
  planned_date: string;
  title: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_HEADERS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function shortcutsFor(role: UserRole): ShortcutCard[] {
  const cards: ShortcutCard[] = [
    {
      href: "/requests",
      title: role === "teacher" ? "Raise requests" : "Open requests",
      body:
        role === "teacher"
          ? "Create a new brief or check your drafts."
          : "Track every request in one place.",
      icon: "requests",
      emphasis: true,
    },
    {
      href: "/calendar",
      title: "Monthly calendar",
      body: "Plan + approve across every school.",
      icon: "calendar",
    },
    {
      href: "/feed",
      title: "Published posts",
      body: "Everything that's live, with links.",
      icon: "published",
    },
  ];

  if (role === "super_admin" || role === "school_admin") {
    cards.push({
      href: "/admin",
      title: role === "super_admin" ? "Manage agency" : "Manage school",
      body:
        role === "super_admin"
          ? "Add schools, invite users, assign designers."
          : "Invite users and manage your school workspace.",
      icon: "agency",
    });
  }

  return cards;
}

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortDate(value: string | null): string {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatCalendarDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function requestSubtitle(request: RequestRow): string {
  return `Updated ${formatShortDate(request.updated_at)}`;
}

type RequestStatusVisual = {
  icon: "requests" | "calendar" | "published" | "agency" | "approved" | "pending" | "hold" | "design";
  iconClass: string;
  badgeClass?: string;
  label?: string;
};

function requestStatusVisual(status: RequestStatus): RequestStatusVisual {
  const fallback = {
    icon: "requests" as const,
    iconClass:
      "bg-violet-50 text-violet-600 shadow-violet-100 dark:bg-violet-950/60 dark:text-violet-300",
  };

  const visuals: Record<RequestStatus, RequestStatusVisual> = {
    draft: {
      icon: "calendar",
      iconClass:
        "bg-orange-50 text-orange-600 shadow-orange-100 dark:bg-orange-950/50 dark:text-orange-300",
    },
    pending_admin_approval: {
      icon: "pending",
      iconClass:
        "bg-amber-50 text-amber-600 shadow-amber-100 dark:bg-amber-950/50 dark:text-amber-300",
    },
    approved: {
      icon: "approved",
      iconClass:
        "bg-emerald-50 text-emerald-500 shadow-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300",
      badgeClass:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
    },
    in_design: {
      icon: "design",
      iconClass:
        "bg-blue-50 text-blue-600 shadow-blue-100 dark:bg-blue-950/50 dark:text-blue-300",
      badgeClass:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
      label: "In progress",
    },
    design_pending_approval: {
      icon: "agency",
      iconClass:
        "bg-violet-50 text-violet-600 shadow-violet-100 dark:bg-violet-950/60 dark:text-violet-300",
    },
    changes_requested: {
      icon: "pending",
      iconClass:
        "bg-rose-50 text-rose-600 shadow-rose-100 dark:bg-rose-950/50 dark:text-rose-300",
    },
    published: {
      icon: "published",
      iconClass:
        "bg-emerald-50 text-emerald-600 shadow-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300",
    },
    archived: fallback,
  };

  return visuals[status];
}

function buildCalendarPreview(now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 35 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return {
      date,
      ymd: toYMD(date),
      currentMonth: date.getMonth() === month,
    };
  });
}

function parsePreviewMonth(value: string | undefined, fallback: Date): Date {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  }

  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12) {
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  }

  return new Date(year, month - 1, 1);
}

function monthParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function countByStatus(requests: RequestRow[]) {
  return requests.reduce(
    (acc, request) => {
      acc[request.status] = (acc[request.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<RequestStatus, number>>,
  );
}

function Sparkline({ color = "violet" }: { color?: "violet" | "emerald" | "amber" | "sky" }) {
  const stroke = {
    violet: "#7c3aed",
    emerald: "#22c55e",
    amber: "#f97316",
    sky: "#2563eb",
  }[color];

  return (
    <svg viewBox="0 0 120 34" fill="none" className="h-8 w-full max-w-24">
      <path
        d="M2 27C13 23 18 18 29 22C39 26 42 30 53 23C63 16 67 14 77 20C88 26 91 22 99 13C107 4 111 14 118 9"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Icon({
  type,
  className = "",
}: {
  type: ShortcutCard["icon"] | "approved" | "pending" | "hold" | "design";
  className?: string;
}) {
  if (type === "requests") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="5" y="4" width="14" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "calendar") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <rect x="4" y="5" width="16" height="15" rx="3" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 10h16M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "published") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 20h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  if (type === "agency") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 20c.8-3.5 2.9-5.5 5-5.5s4.2 2 5 5.5M14.5 20c.5-2.2 1.8-3.6 3.2-3.6 1.3 0 2.5 1.2 3 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "approved") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <path d="M6 12.5l4 4L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "pending") {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={className}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 13l16-8-7 16-2-6-7-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string; changed?: string; month?: string }>;
}) {
  const params = await searchParams;
  const session = await getSessionUser();

  if (!session) return null;

  const supabase = await createClient();
  const displayName = session.full_name?.trim() || session.email;
  const role = session.role;
  const now = new Date();
  const todayYMD = toYMD(now);
  const previewMonth = parsePreviewMonth(params.month, now);
  const previewMonthStart = toYMD(previewMonth);
  const previewMonthEndDate = new Date(
    previewMonth.getFullYear(),
    previewMonth.getMonth() + 1,
    0,
  );
  const previewMonthEnd = toYMD(previewMonthEndDate);
  const previousPreviewMonth = new Date(
    previewMonth.getFullYear(),
    previewMonth.getMonth() - 1,
    1,
  );
  const nextPreviewMonth = new Date(
    previewMonth.getFullYear(),
    previewMonth.getMonth() + 1,
    1,
  );
  const [requestsRes, calendarRes] =
    await Promise.all([
      supabase
        .from("requests")
        .select("id, title, status, updated_at, created_at, school_id")
        .order("updated_at", { ascending: false })
        .returns<RequestRow[]>(),
      supabase
        .from("calendar_items")
        .select("id, planned_date, title")
        .gte("planned_date", previewMonthStart)
        .lte("planned_date", previewMonthEnd)
        .order("planned_date", { ascending: true })
        .limit(12)
        .returns<CalendarRow[]>(),
    ]);

  const requests = requestsRes.data ?? [];
  const calendarItems = calendarRes.data ?? [];
  const statusCounts = countByStatus(requests);
  const totalRequests = requests.length;
  const approved =
    (statusCounts.approved ?? 0) +
    (statusCounts.in_design ?? 0) +
    (statusCounts.design_pending_approval ?? 0) +
    (statusCounts.published ?? 0);
  const pending =
    (statusCounts.pending_admin_approval ?? 0) +
    (statusCounts.design_pending_approval ?? 0);
  const onHold = statusCounts.changes_requested ?? 0;

  const recentRequests = requests.slice(0, 5);

  const calendarCells = buildCalendarPreview(previewMonth);
  const calendarDates = new Set(calendarItems.map((item) => item.planned_date));
  const previousPreviewMonthParam = monthParam(previousPreviewMonth);
  const previewMonthParam = monthParam(nextPreviewMonth);
  const shortcuts = shortcutsFor(role);

  return (
    <div className="min-h-full overflow-hidden bg-[radial-gradient(circle_at_85%_8%,rgba(124,58,237,0.08),transparent_30%),radial-gradient(circle_at_18%_92%,rgba(16,185,129,0.06),transparent_24%),linear-gradient(180deg,#ffffff,rgba(250,250,250,0.9))] px-4 py-4 dark:bg-zinc-950 sm:px-6 lg:px-8">
      {params.changed === "password" && (
        <SuccessToast
          message="Password changed successfully"
          paramName="changed"
        />
      )}

      <div className="mx-auto max-w-7xl space-y-5">
        {params.denied && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            You don&apos;t have access to that page.
          </p>
        )}

        <section className="relative min-h-[108px] animate-[dashboard-fade-up_560ms_ease-out_both] lg:pr-[25rem]">
          <div className="pointer-events-none absolute right-0 -top-1 hidden h-32 w-96 text-violet-500 lg:block">
            <div className="absolute right-36 top-1 h-[86px] w-[108px] rotate-6 overflow-hidden rounded-2xl border border-violet-200/80 bg-white/90 shadow-2xl shadow-violet-200/70 backdrop-blur animate-[dashboard-float-card_5.8s_ease-in-out_infinite]">
              <div className="h-3 bg-gradient-to-r from-violet-500 to-violet-300" />
              <div className="p-3">
                <div className="mb-2 flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-200" />
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-200" />
                </div>
                <Sparkline />
                <span className="mt-2 block h-1.5 w-16 rounded-full bg-violet-100" />
              </div>
            </div>
            <div className="absolute right-11 top-[35px] h-[82px] w-[82px] rounded-full bg-[conic-gradient(from_35deg,#5b21b6_0_34%,#8b5cf6_34%_72%,#c4b5fd_72%_100%)] shadow-2xl shadow-violet-200 animate-[dashboard-float-circle_6.6s_ease-in-out_infinite_600ms]">
              <span className="absolute inset-[1px] rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.42),transparent_34%)]" />
              <span className="absolute left-1/2 top-1/2 h-px w-[43px] origin-left rotate-[35deg] bg-white/35" />
              <span className="absolute left-1/2 top-1/2 h-px w-[43px] origin-left rotate-[155deg] bg-white/30" />
            </div>
            <span className="absolute right-4 top-3 h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_18px_rgba(14,165,233,0.65)] animate-[dashboard-dot-float_4.4s_ease-in-out_infinite]" />
            <span className="absolute right-76 top-8 h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_18px_rgba(124,58,237,0.55)] animate-[dashboard-dot-float_5s_ease-in-out_infinite_400ms]" />
            <span className="absolute right-28 top-0 h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_14px_rgba(167,139,250,0.7)] animate-[dashboard-dot-float_4.7s_ease-in-out_infinite_700ms]" />
            <span className="absolute right-60 top-18 h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_14px_rgba(125,211,252,0.7)] animate-[dashboard-dot-float_5.2s_ease-in-out_infinite_1000ms]" />
            <span className="absolute right-20 top-24 h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_14px_rgba(167,139,250,0.7)] animate-[dashboard-dot-float_4.9s_ease-in-out_infinite_1200ms]" />
            <span className="absolute right-0 top-[68px] h-px w-24 bg-violet-300/80" />
          </div>

          <p className="relative z-10 text-xs font-semibold uppercase text-violet-600">
            Welcome back
          </p>
          <h1 className="relative z-10 mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50 sm:text-4xl">
            {displayName}
          </h1>
          <p className="relative z-10 mt-2.5 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-violet-700 dark:text-violet-300">
              {ROLE_LABELS[role]}
            </span>{" "}
            <span className="mx-1 text-violet-400">•</span>
            {ROLE_NEXT_STEP[role]}
          </p>
        </section>

        <section className="-mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          {shortcuts.map((card, index) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group relative overflow-hidden rounded-2xl border p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none ${
                card.emphasis
                  ? "border-violet-600 bg-gradient-to-br from-violet-700 via-violet-600 to-violet-500 text-white shadow-violet-200/70"
                  : "border-zinc-200 bg-white/95 text-zinc-950 shadow-zinc-200/50 hover:border-violet-200 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-50"
              } animate-[dashboard-fade-up_560ms_ease-out_both]`}
              style={{ animationDelay: `${80 + index * 80}ms` }}
            >
              {card.emphasis && (
                <span className="absolute inset-0 bg-[radial-gradient(circle_at_90%_80%,rgba(255,255,255,0.38),transparent_28%)]" />
              )}
              <div className="relative flex items-center gap-4">
                <span
                  className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                    card.emphasis
                      ? "bg-white text-violet-700"
                      : card.icon === "published"
                        ? "bg-emerald-50 text-emerald-600 shadow-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300"
                  } shadow-lg shadow-violet-200/50`}
                >
                  <Icon type={card.icon} className="h-6 w-6" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold leading-5">
                    {card.title} →
                  </span>
                  <span
                    className={`mt-1 block max-w-xs text-sm leading-5 ${
                      card.emphasis
                        ? "text-white/88"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {card.body}
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(300px,1fr)_minmax(300px,1fr)_minmax(300px,0.9fr)]">
          <div className="min-w-0 space-y-3">
            <h2 className="text-[15px] font-semibold leading-5 text-zinc-950 dark:text-zinc-50">
              Overview
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Total" value={totalRequests} icon="requests" color="violet" />
              <MetricCard label="Approved" value={approved} icon="approved" color="emerald" />
              <MetricCard label="Pending" value={pending} icon="pending" color="amber" />
              <MetricCard label="On Hold" value={onHold} icon="hold" color="sky" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <h2 className="text-[15px] font-semibold leading-5 text-zinc-950 dark:text-zinc-50">
                  Recent requests
                </h2>
                <Link
                  href="/requests"
                  className="text-xs font-medium text-violet-600 transition hover:text-violet-800 dark:text-violet-300"
                >
                  View all
                </Link>
                </div>
              {recentRequests.length > 0 ? (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {recentRequests.map((request, index) => {
                    const visual = requestStatusVisual(request.status);
                    return (
                      <li
                        key={request.id}
                        className="animate-[dashboard-slide-right_480ms_ease-out_both]"
                        style={{ animationDelay: `${index * 60}ms` }}
                      >
                        <Link
                          href={`/requests/${request.id}`}
                          className="flex min-h-[52px] items-center gap-3 px-4 py-2.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                        >
                          <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${visual.iconClass}`}>
                            <Icon type={visual.icon} className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold leading-5 text-zinc-950 dark:text-zinc-50">
                              {request.title}
                            </span>
                            <span className="block truncate text-xs font-medium leading-4 text-zinc-500">
                              {requestSubtitle(request)}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${visual.badgeClass ?? STATUS_BADGE_CLASS[request.status]}`}
                          >
                            {visual.label ?? STATUS_SHORT[request.status]}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-zinc-500">
                  No requests yet.
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <div className="rounded-2xl border border-zinc-200 bg-white/95 p-3.5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-900/80">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold leading-5 text-zinc-950 dark:text-zinc-50">
                  Calendar
                </h2>
                <Link
                  href="/calendar"
                  className="text-xs font-medium text-violet-600 transition hover:text-violet-800 dark:text-violet-300"
                >
                  View full calendar
                </Link>
              </div>
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-sm font-semibold leading-5 text-zinc-950 dark:text-zinc-50">
                  {MONTH_NAMES[previewMonth.getMonth()]} {previewMonth.getFullYear()}
                </p>
                <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  <Link
                    href={`/?month=${previousPreviewMonthParam}`}
                    aria-label="Show previous month"
                    className="text-[0px] leading-none transition after:text-lg after:content-['\2190'] hover:text-violet-700 [&>*]:hidden"
                  >
                    <span>Previous</span>
                  </Link>
                <Link
                  href={`/?month=${previewMonthParam}`}
                  aria-label="Show next month"
                  className="text-[0px] leading-none text-zinc-500 transition after:text-lg after:content-['\2192'] hover:text-violet-700 dark:text-zinc-400 [&>*]:hidden"
                >
                  <span className="text-lg">→</span>
                  Month →
                </Link>
              </div>
              </div>
              <div className="grid grid-cols-7 gap-y-1 text-center">
                {DAY_HEADERS.map((day) => (
                  <div key={day} className="pb-1 text-[10px] font-semibold text-zinc-400">
                    {day}
                  </div>
                ))}
                {calendarCells.map((cell) => {
                  const isToday = cell.ymd === todayYMD;
                  const hasItem = calendarDates.has(cell.ymd);
                  return (
                    <div key={cell.ymd} className="flex h-6 items-center justify-center">
                      <span
                        className={`relative inline-flex h-5.5 w-5.5 items-center justify-center rounded-full text-[11px] ${
                          isToday
                            ? "bg-violet-600 text-white shadow-lg shadow-violet-300 animate-[dashboard-pulse_1.8s_ease-in-out_infinite]"
                            : cell.currentMonth
                              ? "text-zinc-800 dark:text-zinc-200"
                              : "text-zinc-300 dark:text-zinc-700"
                        }`}
                      >
                        {cell.date.getDate()}
                        {hasItem && !isToday && (
                          <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-violet-500" />
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2.5 space-y-1 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
                {calendarItems.slice(0, 3).map((item) => (
                  <Link
                    key={item.id}
                    href={`/calendar/${item.id}`}
                    className="flex items-center gap-3 rounded-xl px-1 py-1 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-violet-600" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {formatCalendarDate(item.planned_date)}
                    </span>
                  </Link>
                ))}
                {calendarItems.length === 0 && (
                  <p className="py-2 text-center text-sm text-zinc-500">
                    No upcoming calendar items.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-lg shadow-zinc-200/45 animate-[dashboard-fade-up_640ms_ease-out_420ms_both] dark:border-zinc-800 dark:bg-zinc-900/80 md:grid-cols-3">
          <Benefit title="Fast approvals" body="Reduce turnaround time" color="violet" />
          <Benefit title="Secure & reliable" body="Your data is protected" color="emerald" />
          <Benefit title="Actionable insights" body="Make better decisions" color="sky" />
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: "requests" | "approved" | "pending" | "hold";
  color: "violet" | "emerald" | "amber" | "sky";
}) {
  const colorClass = {
    violet: "bg-violet-50 text-violet-600 shadow-violet-100",
    emerald: "bg-emerald-50 text-emerald-500 shadow-emerald-100",
    amber: "bg-orange-50 text-orange-600 shadow-orange-100",
    sky: "bg-blue-50 text-blue-600 shadow-blue-100",
  }[color];

  return (
    <div className="grid h-[118px] grid-rows-[auto_1fr] rounded-2xl border border-zinc-200 bg-white/95 p-3.5 shadow-sm shadow-zinc-200/50 animate-[dashboard-fade-up_560ms_ease-out_both] dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full shadow-lg ${colorClass}`}>
          <Icon type={icon} className="h-[22px] w-[22px]" />
        </span>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-3xl font-semibold leading-none text-zinc-950 dark:text-zinc-50">
            <AnimatedNumber value={value} />
          </p>
          <p className="mt-1 whitespace-nowrap text-xs leading-4 text-zinc-500">
            {label}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-end">
        <Sparkline color={color === "amber" ? "amber" : color} />
      </div>
    </div>
  );
}

function Benefit({
  title,
  body,
  color,
}: {
  title: string;
  body: string;
  color: "violet" | "emerald" | "sky";
}) {
  const iconClass = {
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    sky: "bg-sky-50 text-sky-600",
  }[color];
  return (
    <div className="flex items-center gap-4 rounded-xl px-3 py-2">
      <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${iconClass}`}>
        <Sparkline color={color} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          {title}
        </span>
        <span className="text-sm text-zinc-500">{body}</span>
      </span>
    </div>
  );
}
