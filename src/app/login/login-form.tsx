"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signInWithMagicLink, type ActionState } from "./actions";
import { createClient } from "@/lib/supabase/client";

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

const initialState: ActionState = {};

const NATIVE_REDIRECT_URL = "com.mindmaplabs.workflow://auth/callback";

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function signInWithMagicLinkNative(email: string): Promise<ActionState> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: NATIVE_REDIRECT_URL,
    },
  });

  if (error) {
    if (
      /signups?\s+not\s+allowed/i.test(error.message) ||
      /user\s+not\s+found/i.test(error.message)
    ) {
      return {
        error:
          "We couldn't find an account for that email. Ask a super admin to invite you.",
      };
    }
    return { error: error.message };
  }

  return { success: true };
}

async function dispatchSignIn(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (isNativePlatform()) {
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return { error: "Enter your email address." };
    return signInWithMagicLinkNative(email);
  }
  return signInWithMagicLink(prev, formData);
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
            We&apos;ll email you a one-tap sign-in link. No password to remember.
          </p>
        </div>

        {state.success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
            <p className="font-medium">Check your email</p>
            <p className="mt-1">
              We sent a sign-in link. Tap it on the same device you want to be
              signed in on.
            </p>
          </div>
        ) : (
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
              {pending ? "Sending…" : "Send me a sign-in link"}
            </button>
          </form>
        )}

        <p className="mt-8 text-center text-xs text-zinc-500 dark:text-zinc-500">
          Internal team?{" "}
          <Link
            href="/login/team"
            className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
          >
            Sign in with password
          </Link>
        </p>
      </div>
    </main>
  );
}
