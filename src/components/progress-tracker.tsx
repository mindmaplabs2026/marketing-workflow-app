import type { RequestStatus } from "@/lib/supabase/types";

const STEPS: { status: RequestStatus[]; label: string }[] = [
  { status: ["draft"], label: "Draft" },
  { status: ["pending_admin_approval"], label: "Pending" },
  { status: ["approved"], label: "Approved" },
  { status: ["in_design", "changes_requested"], label: "In Design" },
  { status: ["design_pending_approval"], label: "Review" },
  { status: ["published"], label: "Published" },
];

function stepIndex(status: RequestStatus): number {
  if (status === "archived") return -1;
  return STEPS.findIndex((s) => s.status.includes(status));
}

export function ProgressTracker({
  status,
  awaitingPublish = false,
}: {
  status: RequestStatus;
  awaitingPublish?: boolean;
}) {
  // When a design has been approved but the designer hasn't published yet,
  // the schema keeps status="in_design" but the workflow is past Review.
  // Show the tracker as if Review is complete and Published is the active step.
  const PUBLISHED_INDEX = STEPS.findIndex((s) => s.status.includes("published"));
  const current =
    awaitingPublish && status === "in_design"
      ? PUBLISHED_INDEX
      : stepIndex(status);

  if (current < 0) return null; // archived — don't show tracker

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.label} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-0.5 w-4 sm:w-6 ${done ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-700"}`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                }`}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={`mt-1 text-[9px] leading-tight ${
                  active
                    ? "font-medium text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
