import Link from "next/link";

type Props = {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  pageHref: (page: number) => string;
  itemLabel?: string;
};

export function Pagination({
  totalItems,
  pageSize,
  currentPage,
  pageHref,
  itemLabel = "item",
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  return (
    <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
      <span>
        Page {safePage} of {totalPages} · {totalItems} {itemLabel}
        {totalItems === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        {safePage > 1 ? (
          <Link
            href={pageHref(safePage - 1)}
            scroll={false}
            prefetch={false}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Prev
          </Link>
        ) : (
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
            ← Prev
          </span>
        )}
        {safePage < totalPages ? (
          <Link
            href={pageHref(safePage + 1)}
            scroll={false}
            prefetch={false}
            className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
            Next →
          </span>
        )}
      </div>
    </div>
  );
}
