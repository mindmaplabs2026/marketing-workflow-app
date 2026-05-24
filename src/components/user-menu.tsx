"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/login/actions";

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserMenu({
  name,
  email,
  roleLabel,
}: {
  name: string;
  email: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = initialsFor(name, email);
  const display = name.trim() || email;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-4 dark:border-zinc-800">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {display}
              </p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {email}
              </p>
              <p className="mt-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {roleLabel}
              </p>
            </div>
          </div>
          <form action={signOut} className="p-2">
            <button
              type="submit"
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
