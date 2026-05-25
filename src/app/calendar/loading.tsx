import { Skeleton } from "@/components/skeleton";

export default function CalendarLoading() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-7" />
          <Skeleton className="h-6 w-12" />
          <Skeleton className="h-6 w-7" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-950/40">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="mx-auto h-3 w-8" />
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={i}
              className="min-h-24 space-y-1.5 border-b border-r border-zinc-100 p-2 last:border-r-0 dark:border-zinc-800 sm:min-h-32"
            >
              <Skeleton className="h-4 w-5" />
              {i % 3 === 0 && <Skeleton className="h-3 w-full" />}
              {i % 4 === 0 && <Skeleton className="h-3 w-2/3" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
