import { Skeleton } from "@/components/skeleton";

export default function RequestDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4 flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 rounded-md border border-zinc-100 px-3 py-3 dark:border-zinc-800"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-5 w-24" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-5 w-28" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </section>
      </div>
    </div>
  );
}
