"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Option = { value: string; label: string };

type Props = {
  paramName: string;
  options: Option[];
  allLabel?: string;
  resetParams?: string[];
  className?: string;
  ariaLabel?: string;
};

export function SelectFilter({
  paramName,
  options,
  allLabel = "All",
  resetParams = [],
  className,
  ariaLabel,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const current = searchParams.get(paramName) ?? "";

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(paramName, value);
    else params.delete(paramName);
    for (const k of resetParams) params.delete(k);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <select
      aria-label={ariaLabel}
      value={current}
      onChange={(e) => onChange(e.currentTarget.value)}
      className={
        className ??
        "h-10 w-full rounded-xl border border-slate-200 bg-white/85 px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm shadow-slate-200/50 outline-none transition focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      }
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
