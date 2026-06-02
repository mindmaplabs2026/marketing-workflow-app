"use client";

import { useState } from "react";
import Link from "next/link";
import type { RequestStatus } from "@/lib/supabase/types";
import { STATUS_SHORT, STATUS_BADGE_CLASS } from "@/app/requests/status";

type Item = {
  id: string;
  title: string;
  status: RequestStatus;
  creatorName: string;
  schoolName: string;
  date: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export function BulkApproveSection({
  title,
  items,
  approveAction,
}: {
  title: string;
  items: Item[];
  approveAction: (formData: FormData) => void;
}) {
  const approvable = items.filter(
    (r) => r.status === "pending_admin_approval",
  );
  const others = items.filter(
    (r) => r.status !== "pending_admin_approval",
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(approvable.map((r) => r.id)),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === approvable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(approvable.map((r) => r.id)));
    }
  }

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-amber-700 dark:text-amber-300">
        {title} ({items.length})
        {approvable.length > 0 && others.length > 0 && (
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {approvable.length} pending approval · {others.length} design review
          </span>
        )}
      </h2>

      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {approvable.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={selected.has(r.id)}
              onChange={() => toggle(r.id)}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
            />
            <Link
              href={`/requests/${r.id}`}
              className="flex flex-1 items-start justify-between gap-4 transition-colors hover:opacity-80"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {r.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {r.creatorName}
                  {r.schoolName ? ` · ${r.schoolName}` : ""} ·{" "}
                  {formatDate(r.date)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
              >
                {STATUS_SHORT[r.status]}
              </span>
            </Link>
          </li>
        ))}
        {others.map((r) => (
          <li key={r.id}>
            <Link
              href={`/requests/${r.id}`}
              className="flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {r.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {r.creatorName}
                  {r.schoolName ? ` · ${r.schoolName}` : ""} ·{" "}
                  {formatDate(r.date)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
              >
                {STATUS_SHORT[r.status]}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {approvable.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {selected.size === approvable.length
              ? "Deselect all"
              : "Select all"}
          </button>
          <form action={approveAction}>
            {Array.from(selected).map((id) => (
              <input key={id} type="hidden" name="ids" value={id} />
            ))}
            <button
              type="submit"
              disabled={selected.size === 0}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve selected ({selected.size})
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
