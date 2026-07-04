"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type StatusFilter = "all" | "needs" | "in-flight" | "published" | "archived";

type StatusFilterOption = {
  value: StatusFilter;
  label: string;
};

type Props = {
  filters: StatusFilterOption[];
  active: StatusFilter;
  resetParams: string[];
  labelOverride?: Partial<Record<StatusFilter, string>>;
};

export function StatusFilterChips({
  filters,
  active,
  resetParams,
  labelOverride = {},
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function filterHref(value: StatusFilter): string {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("status");
    else params.set("status", value);
    for (const key of resetParams) params.delete(key);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function navigate(value: StatusFilter) {
    const y = window.scrollY;
    startTransition(() => {
      router.replace(filterHref(value), { scroll: false });
    });
    requestAnimationFrame(() => window.scrollTo({ top: y }));
    window.setTimeout(() => window.scrollTo({ top: y }), 80);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 xl:flex-nowrap">
      {filters.map((item) => {
        const isActive = active === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => navigate(item.value)}
            className={`whitespace-nowrap rounded-full px-2 py-1.5 text-[11px] font-semibold shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 motion-reduce:transform-none ${
              isActive
                ? "bg-gradient-to-b from-violet-500 to-violet-700 text-white ring-violet-400/40 shadow-violet-200"
                : item.value === "needs"
                  ? "bg-orange-50 text-orange-600 ring-orange-100 hover:bg-orange-100"
                  : item.value === "in-flight"
                    ? "bg-blue-50 text-blue-600 ring-blue-100 hover:bg-blue-100"
                    : item.value === "published"
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100"
                      : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100"
            }`}
          >
            {labelOverride[item.value] ?? item.label}
          </button>
        );
      })}
    </div>
  );
}
