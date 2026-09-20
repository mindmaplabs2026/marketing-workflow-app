import type { CalendarItemStatus } from "@/lib/supabase/types";

export const CAL_STATUS_LABELS: Record<CalendarItemStatus, string> = {
  drafted: "Drafted",
  admin_approved: "Approved",
  fulfilled: "Published",
  cancelled: "Cancelled",
};

export const CAL_STATUS_DOT_CLASS: Record<CalendarItemStatus, string> = {
  drafted: "bg-zinc-400 dark:bg-zinc-500",
  admin_approved: "bg-violet-500",
  fulfilled: "bg-emerald-500",
  cancelled: "bg-zinc-300 dark:bg-zinc-700",
};

export const CAL_STATUS_BADGE_CLASS: Record<CalendarItemStatus, string> = {
  drafted:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  admin_approved:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200",
  fulfilled:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  cancelled:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export const CAL_STATUS_CARD_CLASS: Record<CalendarItemStatus, string> = {
  drafted:
    "border-zinc-300 bg-zinc-100/95 text-slate-900 hover:border-zinc-400 hover:bg-zinc-200/70",
  admin_approved:
    "border-violet-300 bg-violet-100/95 text-slate-900 hover:border-violet-400 hover:bg-violet-200/70",
  fulfilled:
    "border-emerald-300 bg-emerald-100/95 text-slate-900 hover:border-emerald-400 hover:bg-emerald-200/70",
  cancelled:
    "border-zinc-300 bg-zinc-100/90 text-slate-500 hover:border-zinc-400 hover:bg-zinc-200/60",
};

export const CAL_STATUS_META_CLASS: Record<CalendarItemStatus, string> = {
  drafted: "text-zinc-700",
  admin_approved: "text-violet-800",
  fulfilled: "text-emerald-800",
  cancelled: "text-zinc-600",
};
