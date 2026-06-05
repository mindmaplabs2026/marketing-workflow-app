"use client";

import { useActionState } from "react";
import { resetUserPassword, type ResetPasswordState } from "./actions";

export function ResetPasswordButton({ userId, label }: { userId: string; label: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(
    resetUserPassword,
    {},
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Reset password for ${label}? A new password will be emailed to them.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-zinc-500 hover:text-violet-600 disabled:opacity-50 dark:hover:text-violet-400"
      >
        {pending ? "Resetting…" : "Reset password"}
      </button>
      {state.error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
          Password reset and emailed.
        </p>
      )}
    </form>
  );
}
