"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function RequestRowActions({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) return;
      setOpen(false);
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
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-violet-100"
      >
        <span className="text-lg leading-none">⋮</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_45px_rgba(15,23,42,0.16)] ring-1 ring-black/5"
        >
          {children}
        </div>
      )}
    </div>
  );
}
