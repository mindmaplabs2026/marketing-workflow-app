"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HeaderSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const query = value.trim();
    if (!query) {
      router.push("/requests");
      return;
    }
    router.push(`/requests?q=${encodeURIComponent(query)}`);
  }

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className="relative hidden w-[min(26vw,320px)] min-w-52 md:block"
    >
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search requests..."
        aria-label="Search requests"
        className="h-9 w-full rounded-xl border border-zinc-200 bg-white/80 pl-9 pr-3 text-sm font-medium text-zinc-900 shadow-sm shadow-zinc-200/40 outline-none transition placeholder:text-zinc-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-50 dark:shadow-none dark:focus:border-violet-700 dark:focus:ring-violet-950/40"
      />
    </form>
  );
}
