import type { RequestStatus, UserRole } from "@/lib/supabase/types";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_admin_approval: "Pending admin approval",
  approved: "Approved — with design team",
  in_design: "In design",
  design_pending_approval: "Design ready for review",
  changes_requested: "Changes requested",
  published: "Published",
  archived: "Archived",
};

/**
 * Returns a role-aware status label for the request detail page.
 * Falls back to STATUS_LABELS for statuses that don't vary by role.
 */
export function getStatusLabel(
  status: RequestStatus,
  role: UserRole,
  req?: { created_by: string; approved_by: string | null },
  awaitingPublish?: boolean,
): string {
  if (status === "pending_admin_approval") {
    if (role === "school_admin" || role === "super_admin") {
      return "Awaiting your approval";
    }
    return "Submitted — awaiting admin approval";
  }

  if (status === "in_design" && awaitingPublish) {
    return "Approved — ready to publish";
  }

  if (
    status === "approved" &&
    req &&
    req.created_by === req.approved_by
  ) {
    return "Sent to design team";
  }

  return STATUS_LABELS[status];
}

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
    "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200",
  design_pending_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  changes_requested:
    "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  published:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  archived:
    "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export const STATUS_DOT_CLASS: Record<RequestStatus, string> = {
  draft: "bg-zinc-400 dark:bg-zinc-500",
  pending_admin_approval: "bg-amber-500",
  approved: "bg-sky-500",
  in_design: "bg-violet-500",
  design_pending_approval: "bg-amber-500",
  changes_requested: "bg-rose-500",
  published: "bg-emerald-500",
  archived: "bg-zinc-300 dark:bg-zinc-700",
};
