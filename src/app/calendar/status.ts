import type { CalendarItemStatus } from "@/lib/supabase/types";

export const CAL_STATUS_LABELS: Record<CalendarItemStatus, string> = {
  drafted: "Drafted",
  admin_approved: "Approved",
  fulfilled: "Published",
  cancelled: "Cancelled",
};

export const CAL_STATUS_DOT_CLASS: Record<CalendarItemStatus, string> = {
  drafted: "bg-zinc-400 dark:bg-zinc-500",
  admin_approved: "bg-sky-500",
  fulfilled: "bg-emerald-500",
  cancelled: "bg-zinc-300 dark:bg-zinc-700",
};

export const CAL_STATUS_BADGE_CLASS: Record<CalendarItemStatus, string> = {
  drafted:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  admin_approved:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  fulfilled:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  cancelled:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};
