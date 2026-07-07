import type { RequestStatus } from "@/lib/supabase/types";

const STEPS: { status: RequestStatus[]; label: string }[] = [
  { status: ["draft"], label: "Draft" },
  { status: ["pending_admin_approval"], label: "Pending" },
  { status: ["approved"], label: "Approved" },
  { status: ["in_design", "changes_requested"], label: "In Design" },
  { status: ["design_pending_approval"], label: "Review" },
  { status: ["published"], label: "Published" },
];

const STEP_POSITIONS = [4, 22.4, 40.8, 59.2, 77.6, 96];
const CONNECTORS = [
  "M 7.8 18 C 9.3 22.2, 10.9 21.8, 12.6 16.4 C 14.4 10.8, 16.7 10.8, 18.6 18",
  "M 26.2 18 C 27.7 22.2, 29.3 21.8, 31 16.4 C 32.8 10.8, 35.1 10.8, 37 18",
  "M 44.6 18 C 46.1 22.2, 47.7 21.8, 49.4 16.4 C 51.2 10.8, 53.5 10.8, 55.4 18",
  "M 63 18 C 64.5 22.2, 66.1 21.8, 67.8 16.4 C 69.6 10.8, 71.9 10.8, 73.8 18",
  "M 81.4 18 C 82.9 22.2, 84.5 21.8, 86.2 16.4 C 88 10.8, 90.3 10.8, 92.2 18",
];
const COMPACT_CONNECTORS = [
  "M 14.2 18 C 15.7 22.2, 17.3 21.8, 19 16.4 C 20.8 10.8, 23.1 10.8, 25 18",
  "M 30.9 18 C 32.4 22.2, 34 21.8, 35.7 16.4 C 37.5 10.8, 39.8 10.8, 41.7 18",
  "M 47.6 18 C 49.1 22.2, 50.7 21.8, 52.4 16.4 C 54.2 10.8, 56.5 10.8, 58.4 18",
  "M 64.3 18 C 65.8 22.2, 67.4 21.8, 69.1 16.4 C 70.9 10.8, 73.2 10.8, 75.1 18",
  "M 81 18 C 82.5 22.2, 84.1 21.8, 85.8 16.4 C 87.6 10.8, 89.9 10.8, 91.8 18",
];
const MOBILE_STEP_POSITIONS = [
  { left: 10, top: 0 },
  { left: 50, top: 0 },
  { left: 90, top: 0 },
  { left: 90, top: 88 },
  { left: 50, top: 88 },
  { left: 10, top: 88 },
];
const MOBILE_CONNECTORS = [
  "M 20 28 C 28 17, 35 17, 42 28",
  "M 58 28 C 66 17, 73 17, 80 28",
  "M 92 38 C 102 55, 102 79, 92 96",
  "M 80 116 C 73 105, 66 105, 58 116",
  "M 42 116 C 35 105, 28 105, 20 116",
];

function connectorStroke(index: number, current: number, prefix = ""): string {
  if (index < current - 1) return "#047857";
  if (index === current - 1) return `url(#${prefix}workflowIntoActive-${index})`;
  if (index === current) return `url(#${prefix}workflowOutOfActive-${index})`;
  return "#64748b";
}

function stepIndex(status: RequestStatus): number {
  if (status === "archived") return -1;
  return STEPS.findIndex((s) => s.status.includes(status));
}

export function ProgressTracker({
  status,
  awaitingPublish = false,
  compactMobile = false,
}: {
  status: RequestStatus;
  awaitingPublish?: boolean;
  compactMobile?: boolean;
}) {
  // When a design has been approved but the designer hasn't published yet,
  // the schema keeps status="in_design" but the workflow is past Review.
  // Show the tracker as if Review is complete and Published is the active step.
  const PUBLISHED_INDEX = STEPS.findIndex((s) => s.status.includes("published"));
  const current =
    awaitingPublish && status === "in_design"
      ? PUBLISHED_INDEX
      : stepIndex(status);

  if (current < 0) return null;

  if (compactMobile) {
    return (
      <div className="relative w-full overflow-hidden py-2 md:hidden">
        <svg
          viewBox="0 0 100 36"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-x-0 top-[-0.125rem] h-9 w-full"
        >
          {COMPACT_CONNECTORS.map((path, i) => (
            <path
              key={path}
              d={path}
              fill="none"
              stroke={connectorStroke(i, current, "compact-")}
              strokeWidth="2"
              strokeDasharray="0.01 5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <defs>
            {COMPACT_CONNECTORS.map((_, i) => (
              <linearGradient
                key={`compact-into-${i}`}
                id={`compact-workflowIntoActive-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor="#047857" />
                <stop offset="33%" stopColor="#047857" />
                <stop offset="34%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            ))}
            {COMPACT_CONNECTORS.map((_, i) => (
              <linearGradient
                key={`compact-out-${i}`}
                id={`compact-workflowOutOfActive-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="50%" stopColor="#2563eb" />
                <stop offset="51%" stopColor="#64748b" />
                <stop offset="100%" stopColor="#64748b" />
              </linearGradient>
            ))}
          </defs>
        </svg>
        <div className="relative grid grid-cols-6 gap-1">
          {STEPS.map((step, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div key={step.label} className="min-w-0 text-center">
                <span
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold shadow-sm ${
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? "border-violet-400 bg-violet-600 text-white ring-4 ring-violet-100"
                        : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`mt-1 block truncate text-[10px] font-medium ${
                    active
                      ? "text-slate-950"
                      : done
                        ? "text-emerald-700"
                        : "text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[160px] w-full py-0 md:h-[78px]">
      <div className="relative h-full md:hidden">
        <svg
          viewBox="0 0 112 136"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        >
          {MOBILE_CONNECTORS.map((path, i) => (
            <path
              key={path}
              d={path}
              fill="none"
              stroke={connectorStroke(i, current, "mobile-")}
              strokeWidth="2"
              strokeDasharray="0.01 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <defs>
            {MOBILE_CONNECTORS.map((_, i) => (
              <linearGradient
                key={`mobile-into-${i}`}
                id={`mobile-workflowIntoActive-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor="#047857" />
                <stop offset="33%" stopColor="#047857" />
                <stop offset="34%" stopColor="#2563eb" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            ))}
            {MOBILE_CONNECTORS.map((_, i) => (
              <linearGradient
                key={`mobile-out-${i}`}
                id={`mobile-workflowOutOfActive-${i}`}
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="50%" stopColor="#2563eb" />
                <stop offset="51%" stopColor="#64748b" />
                <stop offset="100%" stopColor="#64748b" />
              </linearGradient>
            ))}
          </defs>
        </svg>
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          const position = MOBILE_STEP_POSITIONS[i];
          return (
            <div
              key={step.label}
              className="absolute -translate-x-1/2"
              style={{ left: `${position.left}%`, top: position.top }}
            >
              <div
                className={`flex min-h-[58px] w-[58px] shrink-0 flex-col items-center justify-center rounded-xl border bg-white/88 px-2 text-center shadow-[0_14px_34px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/80 ${
                  active
                    ? "border-violet-400 shadow-[0_18px_42px_rgba(124,58,237,0.2)] ring-2 ring-violet-100 dark:ring-violet-950"
                    : done
                      ? "border-emerald-100"
                      : "border-slate-200"
                }`}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold shadow-sm ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-slate-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                        : "bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-2 text-[10px] font-medium leading-tight ${
                    active
                      ? "text-slate-950 dark:text-zinc-50"
                      : done
                        ? "text-slate-600 dark:text-zinc-300"
                        : "text-slate-500 dark:text-zinc-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <svg
        viewBox="0 0 100 36"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-x-0 top-4 hidden h-9 w-full md:block"
      >
        {CONNECTORS.map((path, i) => (
          <path
            key={path}
            d={path}
            fill="none"
            stroke={connectorStroke(i, current)}
            strokeWidth="2"
            strokeDasharray="0.01 5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <defs>
          {CONNECTORS.map((_, i) => (
            <linearGradient
              key={`into-${i}`}
              id={`workflowIntoActive-${i}`}
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#047857" />
              <stop offset="33%" stopColor="#047857" />
              <stop offset="34%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
          ))}
          {CONNECTORS.map((_, i) => (
            <linearGradient
              key={`out-${i}`}
              id={`workflowOutOfActive-${i}`}
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="50%" stopColor="#2563eb" />
              <stop offset="51%" stopColor="#64748b" />
              <stop offset="100%" stopColor="#64748b" />
            </linearGradient>
          ))}
        </defs>
      </svg>
      <div className="relative hidden h-full md:block">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div
              key={step.label}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${STEP_POSITIONS[i]}%` }}
            >
              <div
                className={`flex min-h-[64px] w-[58px] shrink-0 flex-col items-center justify-center rounded-xl border bg-white/88 px-2 text-center shadow-[0_14px_34px_rgba(15,23,42,0.08)] ring-1 ring-white/80 backdrop-blur transition dark:border-zinc-800 dark:bg-zinc-900/80 ${
                  active
                    ? "border-violet-400 shadow-[0_18px_42px_rgba(124,58,237,0.2)] ring-2 ring-violet-100 dark:ring-violet-950"
                    : done
                      ? "border-emerald-100"
                      : "border-slate-200"
                }`}
              >
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold shadow-sm ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-slate-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                        : "bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </div>
                <span
                  className={`mt-2 text-[10px] font-medium leading-tight ${
                    active
                      ? "text-slate-950 dark:text-zinc-50"
                      : done
                        ? "text-slate-600 dark:text-zinc-300"
                        : "text-slate-500 dark:text-zinc-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
