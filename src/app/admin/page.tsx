import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHome() {
  const supabase = await createClient();
  const [{ count: schoolCount }, { count: userCount }] = await Promise.all([
    supabase.from("schools").select("*", { count: "exact", head: true }),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Agency dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Bootstrap the workspace, then manage who covers what.
        </p>
      </div>

      <Link
        href="/admin/pipeline"
        className="block rounded-lg border border-zinc-900 bg-zinc-900 p-4 text-white transition-colors hover:bg-violet-700 dark:border-zinc-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
      >
        <p className="text-sm font-medium">Pipeline →</p>
        <p className="mt-1 text-xs opacity-80">
          Every school&apos;s work, grouped by where it&apos;s stuck.
        </p>
      </Link>

      <div className="grid grid-cols-2 gap-4">
        <Link
          href="/admin/schools"
          className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-violet-700"
        >
          <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {schoolCount ?? 0}
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Schools
          </p>
        </Link>
        <Link
          href="/admin/users"
          className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-violet-700"
        >
          <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {userCount ?? 0}
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Users</p>
        </Link>
      </div>
    </div>
  );
}
