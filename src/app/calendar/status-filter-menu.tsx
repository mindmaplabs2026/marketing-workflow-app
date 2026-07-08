"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, Filter, type LucideIcon } from "lucide-react";

export type CalendarFilterOption = {
  href: string;
  label: string;
  selected: boolean;
};

export function CalendarFilterMenu({
  label,
  options,
  icon: Icon = Filter,
  compact = false,
}: {
  label: string;
  options: CalendarFilterOption[];
  icon?: LucideIcon | null;
  compact?: boolean;
}) {
  const buttonClass = compact
    ? "inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-violet-100"
    : "inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-violet-100";

  return <FilterMenuBase label={label} options={options} icon={Icon} buttonClass={buttonClass} />;
}

export function StatusFilterMenu({
  label,
  options,
}: {
  label: string;
  options: CalendarFilterOption[];
}) {
  return <CalendarFilterMenu label={label} options={options} />;
}

function FilterMenuBase({
  label,
  options,
  icon: Icon,
  buttonClass,
}: {
  label: string;
  options: CalendarFilterOption[];
  icon: LucideIcon | null;
  buttonClass: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={buttonClass}
      >
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
        <ChevronRight className="h-3.5 w-3.5 rotate-90 text-slate-400" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-40 rounded-xl border border-slate-200 bg-white p-1 text-xs font-medium text-slate-700 shadow-xl shadow-slate-200/70"
        >
          {options.map((option) => (
            <Link
              key={option.label}
              href={option.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 hover:bg-violet-50 ${
                option.selected ? "text-violet-700" : ""
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
