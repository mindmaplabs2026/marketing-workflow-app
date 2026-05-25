import { Skeleton } from "@/components/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
        <Skeleton className="h-7 w-24" />
      </div>

      <section>
        <Skeleton className="mb-3 h-4 w-20" />
        <div className="space-y-px overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-start gap-3 px-4 py-3">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
