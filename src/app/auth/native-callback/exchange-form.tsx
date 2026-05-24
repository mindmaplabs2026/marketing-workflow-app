"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ExchangeForm({ code }: { code: string }) {
  const router = useRouter();
  const ran = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
        setError(exchangeError.message);
        return;
      }
      router.replace("/");
    });
  }, [code, router]);

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
