"use client";

import { useState } from "react";
import { ChangePasswordForm } from "./change-password-form";

export function PasswordSection({ passwordSet }: { passwordSet: boolean }) {
  const [open, setOpen] = useState(false);
  const action = passwordSet ? "Change your password" : "Set your password";
  const hint = passwordSet
    ? "Pick a new password for your account."
    : "Add a password so you can sign in directly, without waiting for a magic link each time.";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {action}
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4 flex-shrink-0 text-zinc-400"
          aria-hidden
        >
          <path
            d="M9 6l6 6-6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {action}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
