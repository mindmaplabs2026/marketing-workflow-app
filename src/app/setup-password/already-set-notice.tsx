import Link from "next/link";

export function AlreadySetNotice({ email }: { email: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            All set
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            You've already set your password
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">{email}</span> already has a password
            on file. Head to your workspace, or sign out and sign back in if
            you'd like to use a different account.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/"
            className="block w-full rounded-md bg-violet-600 px-4 py-2 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            Go to workspace
          </Link>
          <Link
            href="/login"
            className="block w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Sign in as someone else
          </Link>
        </div>
      </div>
    </main>
  );
}
