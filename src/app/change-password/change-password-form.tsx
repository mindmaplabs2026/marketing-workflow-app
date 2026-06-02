"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = {};
const TEMP_PASSWORD_KEY = "mwa_initial_pwd";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    changePassword,
    initialState,
  );
  const currentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stash = sessionStorage.getItem(TEMP_PASSWORD_KEY);
    if (stash && currentRef.current) {
      currentRef.current.value = stash;
      sessionStorage.removeItem(TEMP_PASSWORD_KEY);
    }
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            One last step
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Change your password
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as <span className="font-medium">{email}</span>. Replace
            the temporary password your admin shared with one only you know.
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label
              htmlFor="current"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Current password
            </label>
            <input
              id="current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              ref={currentRef}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="new"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              New password
            </label>
            <input
              id="new"
              name="new"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            />
          </div>

          <div>
            <label
              htmlFor="confirm"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            {pending ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
