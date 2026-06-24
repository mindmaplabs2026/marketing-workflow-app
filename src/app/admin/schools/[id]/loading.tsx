import { Skeleton } from "@/components/skeleton";

export default function SchoolDetailLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-2 h-4 w-56" />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {[1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center justify-between gap-4 p-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-7 w-20" />
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="h-5 w-28" />
            <div className="mt-4 space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-4 h-9 w-full" />
          </section>
        </aside>
      </div>
    </div>
  );
}
