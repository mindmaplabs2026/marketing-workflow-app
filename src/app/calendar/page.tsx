import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type {
  CalendarItemStatus,
} from "@/lib/supabase/types";
import { CAL_STATUS_DOT_CLASS } from "./status";

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

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const cells: { date: Date; ymd: string; isCurrentMonth: boolean }[] = [];
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

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string; month?: string }>;
}) {
  const { school: schoolParam, month: monthParam } = await searchParams;
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
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          No school yet
        </p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Ask a super admin to add you to your school.
        </p>
      </div>
    );
  }

  const selectedSchool =
    schools.find((s) => s.id === schoolParam) ?? schools[0];

  const { year, month } = parseMonth(monthParam);
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

  const itemsByDate = new Map<string, CalendarItemRow[]>();
  for (const item of items ?? []) {
    const list = itemsByDate.get(item.planned_date) ?? [];
    list.push(item);
    itemsByDate.set(item.planned_date, list);
  }

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, +1);
  const todayYMD = toYMD(new Date());

  const canPlan = role === "designer" || role === "super_admin";

  const monthBase = `/calendar?school=${selectedSchool.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {MONTH_NAMES[month - 1]} {year}
          </h1>
          <Link
            href={`${monthBase}&month=${toMonthParam(prev.year, prev.month)}`}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ←
          </Link>
          <Link
            href={`${monthBase}&month=${toMonthParam(prev.year, prev.month)}`}
            className="sr-only"
          >
            Previous month
          </Link>
          <Link
            href={monthBase}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Today
          </Link>
          <Link
            href={`${monthBase}&month=${toMonthParam(next.year, next.month)}`}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            →
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {schools.length > 1 && (
            <form method="get" action="/calendar" className="flex items-center gap-2">
              <input
                type="hidden"
                name="month"
                value={toMonthParam(year, month)}
              />
              <select
                name="school"
                defaultValue={selectedSchool.id}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Go
              </button>
            </form>
          )}
          {canPlan && (
            <Link
              href={`/calendar/new?school=${selectedSchool.id}&date=${todayYMD}`}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              + Plan an item
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/40">
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              className="px-2 py-1 text-center text-[10px] font-medium uppercase tracking-wider text-zinc-500"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const cellItems = itemsByDate.get(cell.ymd) ?? [];
            const isToday = cell.ymd === todayYMD;
            return (
              <div
                key={cell.ymd}
                className={`min-h-24 border-b border-r border-zinc-100 p-1.5 last:border-r-0 dark:border-zinc-800 ${
                  cell.isCurrentMonth
                    ? "bg-white dark:bg-zinc-900"
                    : "bg-zinc-50/60 text-zinc-400 dark:bg-zinc-950/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] font-medium ${
                      isToday
                        ? "rounded-full bg-zinc-900 px-1.5 py-0.5 text-white dark:bg-zinc-50 dark:text-zinc-900"
                        : cell.isCurrentMonth
                          ? "text-zinc-700 dark:text-zinc-300"
                          : "text-zinc-400"
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>
                  {canPlan && cell.isCurrentMonth && (
                    <Link
                      href={`/calendar/new?school=${selectedSchool.id}&date=${cell.ymd}`}
                      className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      aria-label="Plan on this day"
                    >
                      <span className="text-xs leading-none">+</span>
                    </Link>
                  )}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {cellItems.slice(0, 3).map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/calendar/${it.id}`}
                        className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                          it.status === "cancelled"
                            ? "line-through text-zinc-400"
                            : "text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        <span
                          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${CAL_STATUS_DOT_CLASS[it.status]}`}
                        />
                        <span className="truncate">{it.title}</span>
                      </Link>
                    </li>
                  ))}
                  {cellItems.length > 3 && (
                    <li className="px-1 text-[10px] text-zinc-500">
                      +{cellItems.length - 3} more
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-zinc-500">
        {role !== "decision_maker" && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" /> Drafted
          </span>
        )}
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" /> Approved
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Published
        </span>
      </div>
    </div>
  );
}
