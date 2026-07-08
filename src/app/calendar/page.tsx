import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  Plus,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type { CalendarItemStatus } from "@/lib/supabase/types";
import {
  CalendarOptimizerModal,
  CalendarOptimizerTrigger,
} from "./calendar-optimizer-modal";
import { CAL_STATUS_LABELS } from "./status";
import { CalendarFilterMenu, StatusFilterMenu } from "./status-filter-menu";

type SchoolLite = { id: string; name: string };
type MembershipRow = {
  school_id: string;
  schools: { id: string; name: string } | null;
};

type CalendarItemRow = {
  id: string;
  planned_date: string;
  title: string;
  status: CalendarItemStatus;
};

type CalendarCell = {
  date: Date;
  ymd: string;
  isCurrentMonth: boolean;
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
const STATUS_FILTERS = ["all", "drafted", "admin_approved", "fulfilled", "cancelled"] as const;
const MIX_FILTERS = ["month", "week"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];
type MixFilter = (typeof MIX_FILTERS)[number];

const CHANNEL_STYLES = [
  {
    name: "Instagram",
    dot: "bg-pink-500",
    chartColor: "#ec4899",
    icon: "IG",
    card: "border-pink-100 bg-pink-50/60 text-slate-900 hover:border-pink-200 hover:bg-pink-50",
    muted: "text-pink-700",
  },
  {
    name: "Facebook",
    dot: "bg-blue-500",
    chartColor: "#3b82f6",
    icon: "FB",
    card: "border-blue-100 bg-blue-50/60 text-slate-900 hover:border-blue-200 hover:bg-blue-50",
    muted: "text-blue-700",
  },
  {
    name: "Email",
    dot: "bg-amber-500",
    chartColor: "#f59e0b",
    icon: "EM",
    card: "border-amber-100 bg-amber-50/65 text-slate-900 hover:border-amber-200 hover:bg-amber-50",
    muted: "text-amber-700",
  },
  {
    name: "All channels",
    dot: "bg-emerald-500",
    chartColor: "#10b981",
    icon: "ALL",
    card: "border-emerald-100 bg-emerald-50/60 text-slate-900 hover:border-emerald-200 hover:bg-emerald-50",
    muted: "text-emerald-700",
  },
  {
    name: "Others",
    dot: "bg-violet-500",
    chartColor: "#8b5cf6",
    icon: "OT",
    card: "border-violet-100 bg-violet-50/65 text-slate-900 hover:border-violet-200 hover:bg-violet-50",
    muted: "text-violet-700",
  },
];

function parseMonth(value: string | undefined): { year: number; month: number } {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function toMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildGrid(year: number, month: number) {
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay();
  const gridStart = new Date(year, month - 1, 1 - startWeekday);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + i,
    );
    cells.push({
      date: d,
      ymd: toYMD(d),
      isCurrentMonth: d.getMonth() === month - 1,
    });
  }
  return { cells, gridStart, gridEnd: cells[41].date };
}

function itemChannel(item: CalendarItemRow) {
  const title = item.title.toLowerCase();
  if (title.includes("newsletter") || title.includes("email")) return CHANNEL_STYLES[2];
  if (title.includes("reel") || title.includes("story") || title.includes("instagram")) {
    return CHANNEL_STYLES[0];
  }
  if (title.includes("facebook")) return CHANNEL_STYLES[1];
  if (title.includes("event") || title.includes("assembly")) return CHANNEL_STYLES[4];
  return CHANNEL_STYLES[3];
}

function channelMixGradient(
  channels: Array<{ color: string; percent: number }>,
) {
  let cursor = 0;
  const slices = channels
    .filter((channel) => channel.percent > 0)
    .map((channel) => {
      const start = cursor;
      cursor += channel.percent;
      return `${channel.color} ${start}% ${cursor}%`;
    });

  return `conic-gradient(${slices.length ? slices.join(",") : "#e2e8f0 0% 100%"})`;
}

function formatAgendaDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return {
    weekday: date.toLocaleDateString("en", { weekday: "short" }),
    day: date.getDate(),
  };
}

function formatShortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function weekRangeLabel(start: Date) {
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString("en", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}

function isWithinRange(value: string, start: Date, days: number) {
  const date = new Date(`${value}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + days);
  return date >= start && date < end;
}

function parseStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter)
    ? (value as StatusFilter)
    : "all";
}

function parseMixFilter(value: string | undefined): MixFilter {
  return MIX_FILTERS.includes(value as MixFilter)
    ? (value as MixFilter)
    : "month";
}

function calendarHref({
  school,
  month,
  status,
  mix,
}: {
  school: string;
  month: string;
  status?: StatusFilter;
  mix?: MixFilter;
}) {
  const params = new URLSearchParams({ school, month });
  if (status && status !== "all") params.set("status", status);
  if (mix && mix !== "month") params.set("mix", mix);
  return `/calendar?${params.toString()}`;
}

function mobileEventDotClass(status: CalendarItemStatus) {
  if (status === "fulfilled") return "bg-emerald-500 shadow-emerald-200";
  if (status === "drafted" || status === "admin_approved") {
    return "bg-violet-600 shadow-violet-200";
  }
  return "bg-slate-300 shadow-slate-200";
}

function AvatarStack() {
  return (
    <span className="mt-2 flex items-center">
      {["AK", "NS", "RP"].map((initials, index) => (
        <span
          key={initials}
          className="-ml-1 first:ml-0 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-900 text-[8px] font-semibold text-white shadow-sm"
          style={{ zIndex: 3 - index }}
        >
          {initials}
        </span>
      ))}
      <span className="-ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-white bg-slate-100 text-[8px] font-semibold text-slate-500">
        +2
      </span>
    </span>
  );
}

function CalendarHeroArt() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-[50%] w-[260px] overflow-hidden sm:left-[48%] sm:w-[320px] lg:left-[36%] lg:w-[360px]">
      <div className="absolute left-0 top-1 h-24 w-[260px] overflow-hidden opacity-75 sm:w-[320px] lg:left-2 lg:w-[360px]">
        <div className="absolute left-4 top-12 h-14 w-56 -rotate-3 rounded-full bg-violet-100/50 blur-3xl sm:w-72 lg:w-80" />
        <svg
          viewBox="0 0 600 120"
          fill="none"
          className="absolute left-0 top-4 h-24 w-[360px] -rotate-2 animate-[request-wave-float_7s_ease-in-out_infinite] motion-reduce:animate-none sm:w-[420px] lg:w-[460px]"
          aria-hidden="true"
        >
          <path
            d="M70 40C138 43 190 58 252 44C318 29 374 20 446 29C511 37 552 27 592 10"
            stroke="url(#calendarTrailD)"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.16"
          />
          <path
            d="M68 47C142 52 196 72 260 54C330 32 382 29 452 42C510 53 552 39 590 21"
            stroke="url(#calendarTrailA)"
            strokeWidth="10"
            strokeLinecap="round"
            opacity="0.16"
          />
          <path
            d="M68 62C140 66 204 84 268 66C339 45 397 46 462 58C515 68 554 56 588 38"
            stroke="url(#calendarTrailB)"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.26"
          />
          <path
            d="M71 72C145 80 202 93 266 77C338 59 404 57 468 68C522 78 558 65 590 49"
            stroke="url(#calendarTrailE)"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.14"
          />
          <circle cx="202" cy="18" r="3.5" fill="#a78bfa" opacity="0.75" />
          <circle cx="318" cy="61" r="4" fill="#2563eb" opacity="0.65" />
          <circle cx="442" cy="23" r="3" fill="#c4b5fd" opacity="0.8" />
          <circle cx="92" cy="26" r="2.5" fill="#c4b5fd" opacity="0.72" />
          <circle cx="548" cy="54" r="2.5" fill="#bfdbfe" opacity="0.65" />
          <defs>
            <linearGradient id="calendarTrailD" x1="70" y1="40" x2="592" y2="10" gradientUnits="userSpaceOnUse">
              <stop stopColor="#ddd6fe" stopOpacity="0" />
              <stop offset="0.42" stopColor="#c4b5fd" />
              <stop offset="1" stopColor="#dbeafe" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="calendarTrailA" x1="68" y1="47" x2="590" y2="21" gradientUnits="userSpaceOnUse">
              <stop stopColor="#8b5cf6" stopOpacity="0" />
              <stop offset="0.35" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="calendarTrailB" x1="68" y1="62" x2="588" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#c4b5fd" stopOpacity="0" />
              <stop offset="0.5" stopColor="#7c3aed" />
              <stop offset="1" stopColor="#dbeafe" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="calendarTrailE" x1="71" y1="72" x2="590" y2="49" gradientUnits="userSpaceOnUse">
              <stop stopColor="#bfdbfe" stopOpacity="0" />
              <stop offset="0.52" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#dbeafe" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="absolute left-8 top-2 h-[58px] w-[54px] -rotate-3 rounded-2xl border border-white/90 bg-white/95 p-1.5 shadow-[0_16px_34px_rgba(99,102,241,0.16)] ring-1 ring-violet-100/80 backdrop-blur lg:left-12 lg:h-[64px] lg:w-[60px]">
        <div className="absolute -top-1.5 left-3.5 h-4 w-1.5 rounded-full bg-violet-500 shadow-sm" />
        <div className="absolute -top-1.5 right-3.5 h-4 w-1.5 rounded-full bg-violet-500 shadow-sm" />
        <div className="h-3.5 rounded-t-xl bg-gradient-to-r from-violet-500 via-violet-500 to-blue-500" />
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {[
            "bg-violet-100",
            "bg-slate-100",
            "bg-violet-200",
            "bg-slate-100",
            "bg-violet-500",
            "bg-slate-100",
          ].map((color, index) => (
            <span key={index} className={`h-2 rounded ${color}`} />
          ))}
        </div>
        <CalendarDays className="absolute bottom-1 right-1 h-3 w-3 text-violet-500" />
      </div>
    </div>
  );
}

function MobileProTipCard() {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-white/80 bg-[linear-gradient(135deg,#ffffff_0%,#f7f2ff_54%,#ffffff_100%)] p-5 shadow-[0_22px_70px_rgba(124,58,237,0.14)] ring-1 ring-violet-100/80 lg:hidden">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[58%]">
        <div className="absolute right-2 top-8 h-24 w-24 rounded-full bg-violet-100/70 blur-2xl" />
        <Send className="absolute right-10 top-12 h-16 w-16 -rotate-12 fill-violet-600 text-violet-600 drop-shadow-[0_18px_22px_rgba(124,58,237,0.24)]" />
        <Sparkles className="absolute right-5 top-4 h-4 w-4 text-violet-400" />
        <Sparkles className="absolute bottom-8 right-6 h-3 w-3 text-violet-400" />
      </div>
      <div className="relative max-w-[58%]">
        <h2 className="text-2xl font-semibold tracking-tight text-violet-600">Pro tip</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use AI to scan for gaps in your calendar and optimize content mix.
        </p>
        <CalendarOptimizerTrigger
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-violet-100 bg-white px-4 text-sm font-semibold text-violet-600 shadow-[0_14px_32px_rgba(124,58,237,0.10)] transition active:scale-[0.98] motion-reduce:transform-none"
        >
          <Sparkles className="h-4 w-4" />
          Try it now
        </CalendarOptimizerTrigger>
      </div>
    </div>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    school?: string;
    month?: string;
    status?: string;
    mix?: string;
  }>;
}) {
  const {
    school: schoolParam,
    month: monthParam,
    status: statusParam,
    mix: mixParam,
  } = await searchParams;
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const { id: userId, role } = session;
  const supabase = await createClient();

  let schools: SchoolLite[] = [];
  if (role === "super_admin") {
    const { data } = await supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<SchoolLite[]>();
    schools = data ?? [];
  } else {
    const { data } = await supabase
      .from("school_members")
      .select("school_id, schools ( id, name )")
      .eq("user_id", userId)
      .returns<MembershipRow[]>();
    schools = (data ?? [])
      .map((m) => m.schools)
      .filter((s): s is SchoolLite => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (schools.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-violet-200 bg-white p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
          <Building2 className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-slate-950">You&apos;re not on a school yet.</p>
        <p className="mt-1 text-sm text-slate-500">
          Ask a super admin to add you, then your school&apos;s calendar lives here.
        </p>
      </div>
    );
  }

  const selectedSchool = schools.find((s) => s.id === schoolParam) ?? schools[0];
  const { year, month } = parseMonth(monthParam);
  const selectedStatus = parseStatusFilter(statusParam);
  const selectedMix = parseMixFilter(mixParam);
  const { cells, gridStart, gridEnd } = buildGrid(year, month);

  let itemsQuery = supabase
    .from("calendar_items")
    .select("id, planned_date, title, status")
    .eq("school_id", selectedSchool.id)
    .gte("planned_date", toYMD(gridStart))
    .lte("planned_date", toYMD(gridEnd))
    .order("planned_date", { ascending: true });
  if (role === "decision_maker") {
    itemsQuery = itemsQuery.in("status", ["admin_approved", "fulfilled"]);
  }
  const { data: items } = await itemsQuery.returns<CalendarItemRow[]>();
  const calendarItems = items ?? [];
  const visibleCalendarItems =
    selectedStatus === "all"
      ? calendarItems
      : calendarItems.filter((item) => item.status === selectedStatus);

  const itemsByDate = new Map<string, CalendarItemRow[]>();
  for (const item of visibleCalendarItems) {
    const list = itemsByDate.get(item.planned_date) ?? [];
    list.push(item);
    itemsByDate.set(item.planned_date, list);
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, +1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayYMD = toYMD(today);
  const canPlan = role === "designer" || role === "super_admin";
  const selectedMonthParam = toMonthParam(year, month);
  const weekItems = calendarItems.filter((item) => isWithinRange(item.planned_date, today, 7));
  const scheduledCount = calendarItems.filter((item) => item.status !== "cancelled").length;
  const approvalCount = calendarItems.filter((item) => item.status === "drafted").length;
  const publishingCount = weekItems.filter((item) => item.status !== "cancelled").length;
  const activeDays = new Set(
    calendarItems
      .filter((item) => item.status !== "cancelled")
      .map((item) => item.planned_date),
  );
  const currentMonthDays = cells.filter((cell) => cell.isCurrentMonth);
  const gapsFound = Math.min(
    9,
    Math.max(0, currentMonthDays.filter((cell) => !activeDays.has(cell.ymd)).length - 18),
  );
  const deadlineItems = calendarItems.filter(
    (item) => item.status !== "fulfilled" && item.status !== "cancelled",
  );
  const deadlines = deadlineItems.slice(0, 3);
  const mixItems =
    selectedMix === "week"
      ? weekItems
      : calendarItems.filter((item) => item.planned_date.startsWith(toMonthParam(year, month)));
  const channelCounts = CHANNEL_STYLES.map((channel) => ({ ...channel, count: 0 }));
  for (const item of mixItems) {
    const channel = itemChannel(item);
    if (channel.name === "All channels") {
      for (const name of ["Instagram", "Facebook", "Email", "All channels"]) {
        const target = channelCounts.find((entry) => entry.name === name);
        if (target) target.count += 1;
      }
    } else {
      const target = channelCounts.find((entry) => entry.name === channel.name);
      if (target) target.count += 1;
    }
  }
  const rawChannelTotal = channelCounts.reduce((sum, channel) => sum + channel.count, 0);
  const channelTotal = Math.max(1, rawChannelTotal);
  const channelMix = channelCounts.map((channel) => ({
    ...channel,
    percent: rawChannelTotal === 0 ? 0 : Math.round((channel.count / channelTotal) * 100),
  }));
  const channelChartBackground = channelMixGradient(
    channelMix.map((channel) => ({
      color: channel.chartColor,
      percent: channel.percent,
    })),
  );
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const selectedStatusLabel =
    selectedStatus === "all" ? "All status" : CAL_STATUS_LABELS[selectedStatus];
  const selectedMixLabel = selectedMix === "week" ? "This week" : "This month";

  return (
    <div className="-mx-4 -mt-3 min-h-full overflow-x-hidden bg-[radial-gradient(circle_at_78%_4%,rgba(124,58,237,0.13),transparent_29%),radial-gradient(circle_at_18%_18%,rgba(14,165,233,0.08),transparent_25%),linear-gradient(180deg,#ffffff_0%,#fbfbff_48%,#f8fafc_100%)] px-4 pb-6 pt-3 text-slate-950 sm:-mx-6 sm:px-6 lg:-ml-8 lg:-mr-4 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-4 sm:space-y-5">
      <section className="relative isolate min-h-[146px] overflow-hidden px-0 pb-2 pt-0 sm:min-h-[90px] sm:pb-3">
        <CalendarHeroArt />

        <div className="relative z-10 flex min-h-[82px] flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="shrink-0">
            <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-slate-950 sm:text-[34px]">
              Calendar
            </h1>
            <p className="mt-1.5 max-w-[300px] whitespace-normal text-sm leading-6 text-slate-600 sm:max-w-[560px] xl:whitespace-nowrap">
              Plan campaigns, approvals, and publishing across your school channels.
            </p>
          </div>

          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:gap-3 lg:-mt-0.5 lg:w-auto lg:flex-nowrap lg:justify-end">
            {schools.length > 1 ? (
              <form method="get" action="/calendar" className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 min-[390px]:col-span-1 sm:flex sm:w-auto sm:flex-none">
                <input type="hidden" name="month" value={toMonthParam(year, month)} />
                <label className="sr-only" htmlFor="school">
                  School
                </label>
                <div className="relative min-w-0 flex-1">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <select
                    id="school"
                    name="school"
                    defaultValue={selectedSchool.id}
                    className="h-12 w-full min-w-0 appearance-none rounded-xl border border-slate-200 bg-white/95 pl-10 pr-9 text-sm font-medium text-slate-900 shadow-[0_14px_32px_rgba(15,23,42,0.08)] outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100 sm:min-w-56 lg:w-64"
                  >
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 rotate-90 -translate-y-1/2 text-slate-400" />
                </div>
                <button
                  type="submit"
                  className="h-12 shrink-0 rounded-xl border border-slate-200 bg-white/95 px-4 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:bg-slate-50 motion-reduce:transform-none"
                >
                  Go
                </button>
              </form>
            ) : (
              <div className="col-span-2 inline-flex h-12 min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-4 text-sm font-semibold text-slate-900 shadow-[0_14px_32px_rgba(15,23,42,0.08)] min-[390px]:col-span-1 sm:flex-none lg:w-64">
                <Building2 className="h-4 w-4 text-slate-500" />
                <span className="truncate">{selectedSchool.name}</span>
              </div>
            )}
            {canPlan && (
              <Link
                href={`/calendar/new?school=${selectedSchool.id}&date=${todayYMD}`}
                className="inline-flex h-12 min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3 text-sm font-semibold text-white shadow-[0_18px_36px_rgba(124,58,237,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(124,58,237,0.38)] focus:outline-none focus:ring-4 focus:ring-violet-100 motion-reduce:transform-none sm:px-5"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden min-[390px]:inline">Plan an item</span>
                <span className="min-[390px]:hidden">Plan</span>
              </Link>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:-mt-4 lg:grid-cols-[minmax(0,1fr)_260px] 2xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="contents">
          <section className="order-1 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2 lg:col-start-1 lg:row-start-1 lg:gap-3">
            {[
              {
                label: "Scheduled",
                value: scheduledCount,
                helper: "12% vs last month",
                icon: CalendarDays,
                color: "text-violet-600",
                iconBg: "bg-violet-50",
                trend: "text-emerald-600",
              },
              {
                label: "Awaiting approval",
                value: approvalCount,
                helper: "Needs review",
                icon: UsersRound,
                color: "text-orange-600",
                iconBg: "bg-orange-50",
                trend: "text-rose-500",
              },
              {
                label: "Publishing this week",
                value: publishingCount,
                helper: "15% vs last week",
                icon: Send,
                color: "text-emerald-600",
                iconBg: "bg-emerald-50",
                trend: "text-emerald-600",
              },
              {
                label: "Gaps found",
                value: gapsFound,
                helper: "Review suggestions",
                icon: AlertTriangle,
                color: "text-rose-600",
                iconBg: "bg-rose-50",
                trend: "text-violet-600",
              },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div
                  key={metric.label}
                  className="h-[154px] min-w-0 overflow-hidden rounded-2xl border border-white/85 bg-white/96 p-2.5 shadow-[0_18px_48px_rgba(76,29,149,0.08)] ring-1 ring-violet-100/70 lg:h-[96px] lg:py-3 lg:pl-3 lg:pr-4"
                >
                  <div className="flex h-full flex-col items-start gap-2 lg:flex-row lg:items-center lg:gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl lg:h-12 lg:w-12 lg:rounded-2xl ${metric.iconBg} ${metric.color}`}>
                      <Icon className="h-5 w-5 lg:h-6 lg:w-6" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-medium leading-4 text-slate-500 lg:truncate lg:text-[11px] lg:leading-3.5">{metric.label}</p>
                      <p className="mt-1 text-2xl font-semibold leading-none text-slate-950">{metric.value}</p>
                      <p className={`mt-1 text-[10px] font-medium leading-4 ${metric.trend}`}>{metric.helper}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

        <section id="calendar-grid" className="order-4 min-w-0 overflow-hidden rounded-[24px] border border-white/85 bg-white/96 p-3 shadow-[0_22px_65px_rgba(76,29,149,0.10)] ring-1 ring-violet-100/70 sm:p-4 lg:order-2 lg:col-start-1 lg:row-start-2">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={calendarHref({
                  school: selectedSchool.id,
                  month: toMonthParam(prev.year, prev.month),
                  status: selectedStatus,
                  mix: selectedMix,
                })}
                aria-label="Previous month"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <Link
                href={calendarHref({
                  school: selectedSchool.id,
                  month: toMonthParam(next.year, next.month),
                  status: selectedStatus,
                  mix: selectedMix,
                })}
                aria-label="Next month"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </Link>
              <h2 className="ml-1 truncate text-xl font-semibold tracking-tight text-slate-950 sm:ml-2">
                {MONTH_NAMES[month - 1]} {year}
              </h2>
              <Link
                href={calendarHref({
                  school: selectedSchool.id,
                  month: selectedMonthParam,
                  status: selectedStatus,
                  mix: selectedMix,
                })}
                className="ml-1 hidden h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 min-[380px]:inline-flex"
              >
                Today
              </Link>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <StatusFilterMenu
                label={selectedStatusLabel}
                options={STATUS_FILTERS.map((status) => ({
                  label: status === "all" ? "All status" : CAL_STATUS_LABELS[status],
                  selected: selectedStatus === status,
                  href: calendarHref({
                    school: selectedSchool.id,
                    month: selectedMonthParam,
                    status,
                    mix: selectedMix,
                  }),
                }))}
              />
            </div>
          </div>

          <div className="max-w-full overflow-hidden rounded-2xl border border-slate-200 sm:overflow-x-auto">
            <div className="min-w-0 sm:min-w-[680px]">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/70">
              {DAY_HEADERS.map((day) => (
                <div key={day} className="px-1 py-3 text-center text-[10px] font-semibold text-slate-500 sm:px-2 sm:text-[11px]">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))]">
              {cells.map((cell) => {
                const cellItems = itemsByDate.get(cell.ymd) ?? [];
                const isToday = cell.ymd === todayYMD;
                const isCurrent = cell.isCurrentMonth;

                return (
                  <div
                    key={cell.ymd}
                    className={`relative aspect-square border-b border-r border-slate-100 p-1.5 transition-colors last:border-r-0 sm:aspect-auto sm:min-h-[106px] sm:p-2.5 xl:min-h-[122px] ${
                      isToday
                        ? "bg-violet-50/45 ring-1 ring-inset ring-violet-200"
                        : isCurrent
                          ? "bg-white"
                          : "bg-slate-50/45"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-semibold sm:h-7 sm:min-w-7 ${
                          isToday
                            ? "bg-violet-600 text-white shadow-lg shadow-violet-200"
                            : isCurrent
                              ? "text-slate-900"
                              : "text-slate-400"
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                      {canPlan && isCurrent && (
                        <Link
                          href={`/calendar/new?school=${selectedSchool.id}&date=${cell.ymd}`}
                          aria-label="Plan on this day"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-sm text-slate-400 transition hover:bg-violet-50 hover:text-violet-600 sm:h-7 sm:w-7"
                        >
                          +
                        </Link>
                      )}
                    </div>

                    <div className="relative z-10 flex flex-wrap gap-1 sm:hidden">
                      {cellItems.slice(0, 3).map((item) => (
                        <Link
                          key={item.id}
                          href={`/calendar/${item.id}`}
                          aria-label={item.title}
                          title={item.title}
                          className={`group/dot relative h-2.5 w-2.5 rounded-full shadow-[0_0_0_3px_var(--tw-shadow-color)] transition hover:scale-125 focus-visible:scale-125 focus-visible:outline-none ${mobileEventDotClass(item.status)}`}
                        >
                          <span className="pointer-events-none absolute left-1/2 top-4 z-30 w-max max-w-[160px] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold leading-3.5 text-slate-900 opacity-0 shadow-[0_14px_35px_rgba(15,23,42,0.16)] ring-1 ring-white transition group-hover/dot:opacity-100 group-focus-visible/dot:opacity-100">
                            {item.title}
                          </span>
                        </Link>
                      ))}
                    </div>

                    <ul className="hidden space-y-1.5 sm:block">
                      {cellItems.slice(0, 2).map((item) => {
                        const channel = itemChannel(item);
                        return (
                          <li key={item.id}>
                            <Link
                              href={`/calendar/${item.id}`}
                              className={`block rounded-xl border px-2.5 py-2 text-[11px] leading-tight shadow-sm transition ${channel.card} ${
                                item.status === "cancelled" ? "opacity-50 line-through" : ""
                              }`}
                            >
                              <span className="flex items-start gap-1.5">
                                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${channel.dot}`} />
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold">{item.title}</span>
                                  <span className={`mt-1 block truncate text-[10px] font-medium ${channel.muted}`}>
                                    {channel.name}
                                  </span>
                                </span>
                              </span>
                              {isToday && <AvatarStack />}
                            </Link>
                          </li>
                        );
                      })}
                      {cellItems.length > 2 && (
                        <li className="px-2 text-[11px] font-semibold text-violet-600">
                          +{cellItems.length - 2} more
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
            </div>
          </div>

          <div className="mt-4 hidden flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500 sm:flex">
            {CHANNEL_STYLES.map((channel) => (
              <span key={channel.name} className="inline-flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${channel.dot}`} />
                {channel.name}
              </span>
            ))}
          </div>
        </section>
        </div>

        <aside className="order-3 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:-mt-8">
          <MobileProTipCard />

          <div className="rounded-[22px] border border-white/80 bg-white p-4 shadow-[0_20px_65px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-violet-600" />
                <h2 className="text-sm font-semibold text-slate-950">This week</h2>
              </div>
              <span className="text-xs font-medium text-slate-500">{weekRangeLabel(today)}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {(weekItems.length ? weekItems : calendarItems.slice(0, 3)).slice(0, 4).map((item) => {
                const date = formatAgendaDate(item.planned_date);
                const channel = itemChannel(item);
                return (
                  <Link key={item.id} href={`/calendar/${item.id}`} className="grid grid-cols-[42px_1fr_auto] gap-3 py-3">
                    <div className="text-xs text-slate-500">
                      <span className="block">{date.weekday}</span>
                      <span className="block text-lg font-semibold leading-none text-slate-900">{date.day}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{channel.name}</p>
                    </div>
                    <Clock3 className="mt-1 h-4 w-4 text-slate-300" />
                  </Link>
                );
              })}
              {calendarItems.length === 0 && (
                <p className="py-6 text-sm leading-5 text-slate-500">No planned items yet. Add one to build this week&apos;s agenda.</p>
              )}
            </div>
            <Link href="#calendar-grid" className="mt-2 inline-flex text-xs font-semibold text-violet-600">
              View full agenda
            </Link>
          </div>

          <div className="rounded-[22px] border border-white/80 bg-white p-4 shadow-[0_20px_65px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-950">Channel mix</h2>
              <CalendarFilterMenu
                label={selectedMixLabel}
                compact
                icon={null}
                options={MIX_FILTERS.map((mix) => ({
                  label: mix === "week" ? "This week" : "This month",
                  selected: selectedMix === mix,
                  href: calendarHref({
                    school: selectedSchool.id,
                    month: selectedMonthParam,
                    status: selectedStatus,
                    mix,
                  }),
                }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <div
                className="relative h-24 w-24 shrink-0 rounded-full lg:h-[88px] lg:w-[88px]"
                style={{ background: channelChartBackground }}
              >
                <div className="absolute inset-4 rounded-full bg-white shadow-inner" />
              </div>
              <div className="min-w-[128px] flex-1 space-y-2">
                {channelMix.map((channel) => (
                  <div key={channel.name} className="grid grid-cols-[minmax(86px,1fr)_auto] items-center gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${channel.dot}`} />
                      <span className="whitespace-nowrap">{channel.name}</span>
                    </span>
                    <span className="font-semibold text-slate-700">{channel.percent}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border border-white/80 bg-white p-4 shadow-[0_20px_65px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/70">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-950">Approval deadlines</h2>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
                  {deadlineItems.length}
                </span>
              </div>
              <Link
                href={calendarHref({
                  school: selectedSchool.id,
                  month: selectedMonthParam,
                  status: "drafted",
                  mix: selectedMix,
                })}
                className="text-xs font-semibold text-violet-600 transition hover:text-violet-800"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {deadlines.map((item, index) => {
                const channel = itemChannel(item);
                return (
                  <Link key={item.id} href={`/calendar/${item.id}`} className="flex gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${index === 0 ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>
                      {index === 0 ? <UsersRound className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{item.title}</span>
                      <span className="block text-xs text-slate-500">{formatShortDate(item.planned_date)} - {channel.name}</span>
                    </span>
                  </Link>
                );
              })}
              {deadlines.length === 0 && (
                <p className="text-sm leading-5 text-slate-500">No approval deadlines in this calendar window.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
      <CalendarOptimizerModal
        schoolId={selectedSchool.id}
        schoolName={selectedSchool.name}
        monthLabel={monthLabel}
        monthParam={toMonthParam(year, month)}
        canPlan={canPlan}
        plannedCount={scheduledCount}
        approvalCount={approvalCount}
        gapCount={gapsFound}
        items={calendarItems.map((item) => ({
          id: item.id,
          title: item.title,
          planned_date: item.planned_date,
          status: item.status,
          channel: itemChannel(item).name,
        }))}
      />
      </div>
    </div>
  );
}
