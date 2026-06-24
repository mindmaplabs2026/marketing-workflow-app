import { Skeleton } from "@/components/skeleton";

export default function CalendarItemDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-10 w-44" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <Skeleton className="h-5 w-32" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </section>
    </div>
  );
}
