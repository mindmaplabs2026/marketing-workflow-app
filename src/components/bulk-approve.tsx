"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { RequestStatus } from "@/lib/supabase/types";
import { STATUS_SHORT, STATUS_BADGE_CLASS } from "@/app/requests/status";
import { ConfirmForm } from "@/components/confirm-form";

type Item = {
  id: string;
  title: string;
  status: RequestStatus;
  creatorName: string;
  schoolName: string;
  date: string;
  canDelete?: boolean;
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
  totalCount,
  totalApprovable,
  totalOthers,
  pagination,
  approveAction,
  deleteAction,
}: {
  title: string;
  items: Item[];
  totalCount?: number;
  totalApprovable?: number;
  totalOthers?: number;
  pagination?: ReactNode;
  approveAction: (formData: FormData) => void;
  deleteAction?: (formData: FormData) => void;
}) {
  const approvable = items.filter(
    (r) => r.status === "pending_admin_approval",
  );
  const others = items.filter(
    (r) => r.status !== "pending_admin_approval",
  );
  const displayedTotal = totalCount ?? items.length;
  const displayedApprovable = totalApprovable ?? approvable.length;
  const displayedOthers = totalOthers ?? others.length;

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
        {title} ({displayedTotal})
        {displayedApprovable > 0 && displayedOthers > 0 && (
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {displayedApprovable} pending approval · {displayedOthers} design
            review
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
              className="flex flex-1 flex-col gap-1.5 transition-colors hover:opacity-80 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
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
                className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
              >
                {STATUS_SHORT[r.status]}
              </span>
            </Link>
            {r.canDelete && deleteAction && (
              <ConfirmForm
                action={deleteAction}
                title="Delete request?"
                message={`Permanently delete "${r.title}"? Attachments are removed too. Use Archive to keep a record.`}
                confirmLabel="Delete"
              >
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  aria-label={`Delete ${r.title}`}
                  className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
                >
                  Delete
                </button>
              </ConfirmForm>
            )}
          </li>
        ))}
        {others.map((r) => (
          <li key={r.id} className="flex items-stretch">
            <Link
              href={`/requests/${r.id}`}
              className="flex flex-1 flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
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
                className={`w-fit shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_BADGE_CLASS[r.status]}`}
              >
                {STATUS_SHORT[r.status]}
              </span>
            </Link>
            {r.canDelete && deleteAction && (
              <ConfirmForm
                action={deleteAction}
                title="Delete request?"
                message={`Permanently delete "${r.title}"? Attachments are removed too. Use Archive to keep a record.`}
                confirmLabel="Delete"
                className="flex items-center pr-3"
              >
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  aria-label={`Delete ${r.title}`}
                  className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
                >
                  Delete
                </button>
              </ConfirmForm>
            )}
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

      {pagination}
    </section>
  );
}
