"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { deleteUser } from "./actions";

export function DeleteUserButton({
  userId,
  label,
}: {
  userId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.append("user_id", userId);
        await deleteUser(fd);
        setOpen(false);
      } catch (e) {
        setOpen(false);
        setError(e instanceof Error ? e.message : "Failed to delete.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={pending}
        className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && (
        <p className="max-w-[16rem] text-right text-[11px] leading-tight text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={open}
        title="Delete user?"
        message={`This permanently removes ${label}'s account. They'll lose access immediately.`}
        confirmLabel="Delete"
        destructive
        busy={pending}
        onCancel={() => setOpen(false)}
        onConfirm={doDelete}
      />
    </div>
  );
}
