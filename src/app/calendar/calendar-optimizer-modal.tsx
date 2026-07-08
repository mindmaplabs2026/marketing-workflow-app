"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

export type CalendarOptimizerItem = {
  id: string;
  title: string;
  planned_date: string;
  status: string;
  channel: string;
};

export function CalendarOptimizerTrigger({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("calendar-optimizer:open"))}
      className={className}
    >
      {children}
    </button>
  );
}

type OptimizerSuggestion = {
  title: string;
  date: string;
  channel: string;
  priority?: "high" | "medium" | "low";
  reason: string;
  brief?: string;
};

type OptimizerResponse = {
  summary: string;
  risks: string[];
  suggestions: OptimizerSuggestion[];
  source: "ai" | "fallback";
};

export function CalendarOptimizerModal({
  schoolId,
  schoolName,
  monthLabel,
  monthParam,
  canPlan,
  items,
  plannedCount,
  approvalCount,
  gapCount,
}: {
  schoolId: string;
  schoolName: string;
  monthLabel: string;
  monthParam: string;
  canPlan: boolean;
  items: CalendarOptimizerItem[];
  plannedCount: number;
  approvalCount: number;
  gapCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plannedDays = useMemo(
    () => new Set(items.map((item) => item.planned_date)).size,
    [items],
  );
  const channelsUsed = useMemo(
    () => new Set(items.map((item) => item.channel)).size,
    [items],
  );

  useEffect(() => {
    function openOptimizer() {
      setOpen(true);
      setError(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("calendar-optimizer:open", openOptimizer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("calendar-optimizer:open", openOptimizer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function generateIdeas() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/calendar-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolName,
          monthLabel,
          monthParam,
          items,
        }),
      });

      const data = (await response.json()) as Partial<OptimizerResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not generate calendar ideas.");
      }

      setResult({
        summary: data.summary ?? "Here are the best calendar improvements for this month.",
        risks: Array.isArray(data.risks) ? data.risks : [],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        source: data.source === "ai" ? "ai" : "fallback",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate calendar ideas.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 px-0 py-0 backdrop-blur-md sm:items-center sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-optimizer-title"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="max-h-[90dvh] w-full max-w-3xl overflow-hidden rounded-t-[28px] border border-white/80 bg-white shadow-[0_32px_100px_rgba(15,23,42,0.35)] ring-1 ring-slate-200 sm:max-h-[92vh] sm:rounded-[28px]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(124,58,237,0.18),transparent_28%),linear-gradient(110deg,transparent,rgba(59,130,246,0.08),transparent)]" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex gap-3 sm:gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-600 text-white shadow-lg shadow-violet-200 sm:h-12 sm:w-12">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">
                  {schoolName}
                </p>
                <h2 id="calendar-optimizer-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                  Calendar Planning Assistant
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
                  Review {monthLabel} for content gaps, approval risks, and practical school marketing ideas.
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close calendar optimizer"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/80 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-violet-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(90dvh-92px)] overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[calc(92vh-96px)] sm:p-6">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Month", monthLabel],
              ["Planned", `${plannedCount} item${plannedCount === 1 ? "" : "s"}`],
              ["Approvals", `${approvalCount} pending`],
              ["Gaps", `${gapCount} found`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  {label}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {[
              {
                title: "Content gaps",
                body: `${plannedDays} active day${plannedDays === 1 ? "" : "s"} planned. Find quiet slots and lightweight content ideas.`,
                icon: CalendarPlus,
                tone: "bg-violet-50 text-violet-700",
              },
              {
                title: "Approval risks",
                body: `${approvalCount} item${approvalCount === 1 ? "" : "s"} may need attention before publishing dates.`,
                icon: AlertTriangle,
                tone: "bg-orange-50 text-orange-700",
              },
              {
                title: "Channel balance",
                body: `${channelsUsed} channel${channelsUsed === 1 ? "" : "s"} active this month. Review the content mix.`,
                icon: BarChart3,
                tone: "bg-emerald-50 text-emerald-700",
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-slate-950">{card.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{card.body}</p>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error} Try again, or review the calendar manually for now.
            </div>
          )}

          {result && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-violet-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Optimization summary</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{result.summary}</p>
                    {result.source === "fallback" && (
                      <p className="mt-2 text-xs font-medium text-violet-600">
                        Live generation was unavailable, so these suggestions were created from the current calendar data.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {result.risks.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-950">Things to review</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {result.risks.slice(0, 3).map((risk) => (
                      <div key={risk} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                        {risk}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-semibold text-slate-950">Generated ideas</p>
                <div className="space-y-2">
                  {result.suggestions.map((suggestion) => (
                    <div key={`${suggestion.date}-${suggestion.title}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-950">{suggestion.title}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                              {suggestion.channel}
                            </span>
                            {suggestion.priority && (
                              <span className="rounded-full bg-violet-50 px-2 py-1 text-[11px] font-semibold capitalize text-violet-700">
                                {suggestion.priority} priority
                              </span>
                            )}
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                            <Clock3 className="h-3.5 w-3.5" />
                            {suggestion.date}
                          </p>
                          <p className="mt-2 text-sm leading-5 text-slate-600">{suggestion.reason}</p>
                          {suggestion.brief && (
                            <p className="mt-2 flex gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                              {suggestion.brief}
                            </p>
                          )}
                        </div>
                        {canPlan && (
                          <Link
                            href={`/calendar/new?school=${schoolId}&date=${suggestion.date}`}
                            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                          >
                            Add to calendar
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 bg-white/95 px-4 pb-1 pt-3 backdrop-blur sm:static sm:mx-0 sm:flex-row sm:justify-end sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:pt-0">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
            >
              Review later
            </button>
            <button
              type="button"
              onClick={generateIdeas}
              disabled={loading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-4 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(124,58,237,0.28)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transform-none"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? "Reviewing calendar..." : result ? "Generate again" : "Generate ideas"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
