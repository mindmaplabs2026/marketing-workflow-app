"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Props = {
  initialValue?: string;
  paramName?: string;
  placeholder?: string;
  resetParams?: string[];
  debounceMs?: number;
};

export function SearchInput({
  initialValue = "",
  paramName = "q",
  placeholder = "Search…",
  resetParams = [],
  debounceMs = 250,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();
  const resetKey = resetParams.join(",");

  useEffect(() => {
    const trimmed = value.trim();
    const current = (searchParams.get(paramName) ?? "").trim();
    if (trimmed === current) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) params.set(paramName, trimmed);
      else params.delete(paramName);
      for (const k of resetKey.split(",").filter(Boolean)) params.delete(k);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [value, paramName, pathname, router, searchParams, debounceMs, resetKey]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-busy={isPending}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-1.5 text-base leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ×
        </button>
      )}
    </div>
  );
}
