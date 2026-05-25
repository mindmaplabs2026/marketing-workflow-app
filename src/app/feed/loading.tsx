import { Skeleton } from "@/components/skeleton";

export default function FeedLoading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          >
            <Skeleton className="h-48 w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
