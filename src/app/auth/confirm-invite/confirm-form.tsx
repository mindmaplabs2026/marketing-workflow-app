"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { confirmInvite } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
    >
      {pending ? "Verifying…" : "Continue"}
    </button>
  );
}

export function ConfirmInviteForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // On native (Capacitor) we auto-submit so the WebView-handled deep link
  // feels like a single tap instead of two. Email scanners run server-side,
  // so they never execute this — the GET-only render is still safe.
  useEffect(() => {
    if (autoSubmitted) return;
    if (typeof window === "undefined") return;
    const isNative = Boolean(
      (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } })
        .Capacitor?.isNativePlatform?.(),
    );
    if (!isNative) return;
    setAutoSubmitted(true);
    formRef.current?.requestSubmit();
  }, [autoSubmitted]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Confirm
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Continue to your workspace
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Tap continue to verify this link and sign in.
          </p>
        </div>

        <form ref={formRef} action={confirmInvite} className="space-y-4">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <SubmitButton />
        </form>
      </div>
    </main>
  );
}
