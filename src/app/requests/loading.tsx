import { Skeleton } from "@/components/skeleton";

export default function RequestsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      {[1, 2].map((section) => (
        <section key={section} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <div className="space-y-px overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
