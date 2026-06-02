"use client";

import { useActionState } from "react";
import { signInWithPassword, type ActionState } from "./actions";

const initialState: ActionState = {};

const TEMP_PASSWORD_KEY = "mwa_initial_pwd";

async function dispatchSignIn(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Stash the typed password so /change-password can pre-fill it as the
  // "current password" after the first-login forced redirect. The key is
  // cleared by /change-password the moment it reads it.
  if (typeof window !== "undefined") {
    const pwd = String(formData.get("password") ?? "");
    if (pwd) sessionStorage.setItem(TEMP_PASSWORD_KEY, pwd);
  }
  return signInWithPassword(prev, formData);
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState(
    dispatchSignIn,
    initialState,
  );

  const errorMessage = state.error ?? initialError;

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Sign in
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Use the email and password your admin shared with you.
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
              placeholder="you@school.edu"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-100 dark:focus:ring-zinc-100"
            />
          </div>

          {errorMessage && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {errorMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
