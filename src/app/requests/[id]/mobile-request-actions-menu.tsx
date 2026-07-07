"use client";

import Link from "next/link";
import { MoreVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConfirmForm } from "@/components/confirm-form";
import { archiveRequest, deleteRequest } from "../actions";

export function MobileRequestActionsMenu({
  requestId,
  canEdit,
  canArchive,
  canDelete,
}: {
  requestId: string;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeIfOutside(event: MouseEvent | TouchEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("touchstart", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("touchstart", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!canEdit && !canArchive && !canDelete) return null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Open request actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/90 bg-white/90 text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/70 backdrop-blur-xl transition hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-violet-100 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-300"
      >
        <MoreVertical className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-[60] w-44 overflow-hidden rounded-2xl border border-slate-200/80 bg-white/98 p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.18)] ring-1 ring-white/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/98">
          {canEdit && (
            <Link
              href={`/requests/${requestId}/edit`}
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center rounded-xl px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Edit
            </Link>
          )}
          {canArchive && (
            <ConfirmForm
              action={archiveRequest}
              message="Archive this request? It will be moved to the archived section."
            >
              <input type="hidden" name="id" value={requestId} />
              <button
                type="submit"
                className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Archive
              </button>
            </ConfirmForm>
          )}
          {canDelete && (
            <ConfirmForm
              action={deleteRequest}
              title="Delete request?"
              message="This permanently removes the request and any attachments. Use Archive instead to keep a record."
              confirmLabel="Delete"
            >
              <input type="hidden" name="id" value={requestId} />
              <button
                type="submit"
                className="flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
              >
                Delete
              </button>
            </ConfirmForm>
          )}
        </div>
      )}
    </div>
  );
}
