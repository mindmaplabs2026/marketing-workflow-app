"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ExchangeForm() {
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // createBrowserClient defaults detectSessionInUrl to true, so the
    // first auth call awaits _initialize() which itself exchanges any
    // PKCE ?code= in the URL and consumes the verifier. Calling
    // exchangeCodeForSession ourselves would race that internal call
    // and the loser would see "PKCE code verifier not found in
    // storage." getSession waits for init to settle, then tells us
    // whether a session was actually established.
    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        setError("Sign-in didn't complete. Request a new link and try again.");
        return;
      }

      // Hand the tokens to the server so it can write the auth cookies
      // via Set-Cookie. Without this the WebView's document.cookie has
      // the session but the very next SSR navigation doesn't see it and
      // the AppShell renders without chrome.
      try {
        const res = await fetch("/api/auth/native-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          }),
        });
        if (!res.ok) {
          setError("Sign-in didn't complete. Request a new link and try again.");
          return;
        }
      } catch {
        setError("Sign-in didn't complete. Request a new link and try again.");
        return;
      }

      // Full reload so the new server-side cookies are used for the
      // first SSR render of "/". router.replace would reuse the cached
      // RSC payload that was fetched without the cookie.
      window.location.replace("/");
    });
  }, []);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Sign-in failed
            </h1>
            <p className="mt-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
            >
              Back to sign-in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Signing you in…
            </h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Hang tight, finishing up.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
