import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-md px-6 text-center">
        <h1 className="text-6xl font-bold text-zinc-300 dark:text-zinc-700">
          404
        </h1>
        <p className="mt-4 text-lg font-medium text-zinc-900 dark:text-zinc-50">
          Page not found
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
