"use client";

import { useState, useTransition } from "react";
import { AlertDialog } from "@/components/alert-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import { deleteUser } from "./actions";

export function DeleteUserButton({
  userId,
  label,
}: {
  userId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function doDelete() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("user_id", userId);
      const result = await deleteUser(fd);
      setConfirmOpen(false);
      if (result?.error) {
        setError(result.error);
        toast.error(result.error);
      } else {
        toast.success(`${label} deleted`);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
        disabled={pending}
        className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete user?"
        message={`This permanently removes ${label}'s account. They'll lose access immediately.`}
        confirmLabel="Delete"
        destructive
        busy={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={doDelete}
      />
      <AlertDialog
        open={error !== null}
        title={`Can't delete ${label}`}
        message={error ?? ""}
        actionLabel="Got it"
        tone="warning"
        onClose={() => setError(null)}
      />
    </>
  );
}
