import type { RequestStatus } from "@/lib/supabase/types";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_admin_approval: "Awaiting your approval",
  approved: "Approved — with design team",
  in_design: "In design",
  design_pending_approval: "Design ready for review",
  changes_requested: "Changes requested",
  published: "Published",
  archived: "Archived",
};

export const STATUS_SHORT: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_admin_approval: "Pending approval",
  approved: "Approved",
  in_design: "In design",
  design_pending_approval: "Design review",
  changes_requested: "Changes requested",
  published: "Published",
  archived: "Archived",
};

export const STATUS_BADGE_CLASS: Record<RequestStatus, string> = {
  draft:
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  pending_admin_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  approved:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  in_design:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  design_pending_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  changes_requested:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-200",
  published:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  archived:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};
