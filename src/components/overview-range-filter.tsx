"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Option = { value: string; label: string };

const CUSTOM = "custom";

function formatDateShort(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Range selector for the Request overview card: preset periods plus a
 * "Custom range" option that opens a from/to date picker (native calendar
 * inputs) and applies `overview=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.
 */
export function OverviewRangeFilter({
  presets,
  defaultValue = "this-week",
  className,
}: {
  presets: Option[];
  defaultValue?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const current = searchParams.get("overview") ?? defaultValue;
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";
  const isCustomActive = current === CUSTOM && !!urlFrom && !!urlTo;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date().toISOString().slice(0, 10);

  function navigate(params: URLSearchParams) {
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onSelect(value: string) {
    if (value === CUSTOM) {
      setPickerOpen(true);
      return;
    }
    setPickerOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    if (value === defaultValue) params.delete("overview");
    else params.set("overview", value);
    params.delete("from");
    params.delete("to");
    navigate(params);
  }

  function applyCustom() {
    if (!from || !to) return;
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const params = new URLSearchParams(searchParams.toString());
    params.set("overview", CUSTOM);
    params.set("from", lo);
    params.set("to", hi);
    setPickerOpen(false);
    navigate(params);
  }

  const customLabel = isCustomActive
    ? `${formatDateShort(urlFrom)} – ${formatDateShort(urlTo)}`
    : "Custom range…";

  return (
    <div ref={containerRef} className="relative">
      <select
        aria-label="Filter request overview range"
        value={pickerOpen || isCustomActive ? CUSTOM : current}
        onChange={(e) => onSelect(e.currentTarget.value)}
        className={
          className ??
          "h-8 rounded-lg border border-slate-200 bg-white/70 px-2.5 text-xs font-medium text-slate-600 shadow-sm outline-none transition focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
        }
      >
        {presets.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value={CUSTOM}>{customLabel}</option>
      </select>

      {pickerOpen && (
        <div className="absolute right-0 top-9 z-30 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
          <p className="mb-2 text-xs font-semibold text-slate-500">Custom date range</p>
          <label className="mb-2 block text-xs text-slate-600">
            From
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.currentTarget.value)}
              className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            />
          </label>
          <label className="mb-3 block text-xs text-slate-600">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={today}
              onChange={(e) => setTo(e.currentTarget.value)}
              className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                setFrom(urlFrom);
                setTo(urlTo);
              }}
              className="h-7 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyCustom}
              disabled={!from || !to}
              className="h-7 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
