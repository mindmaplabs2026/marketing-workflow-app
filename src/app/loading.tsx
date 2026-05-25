import { Skeleton } from "@/components/skeleton";

export default function HomeLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-6">
        <div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-8 w-48 sm:h-9" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
