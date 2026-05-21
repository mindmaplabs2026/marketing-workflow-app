import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";
import type { UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const ROLE_NEXT_STEP: Record<UserRole, string> = {
  super_admin: "Manage schools and users, or jump into the request board.",
  designer:
    "Pick up approved requests, design, publish — all from the queue.",
  school_admin: "Raise new requests, approve drafts, and track what's in flight.",
  teacher: "Raise a request — your school admin gives the OK.",
  decision_maker:
    "See the month's plan and every post that's gone live for your school.",
};

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The proxy guard guarantees `user` is non-null on protected routes.
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single<{ full_name: string | null; role: UserRole }>();

  const role: UserRole = profile?.role ?? "teacher";

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Signed in
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {profile?.full_name?.trim() || user.email}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {user.email} · {ROLE_LABELS[role]}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            What&apos;s next for you
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {ROLE_NEXT_STEP[role]}
          </p>
        </div>

        {(role === "teacher" ||
          role === "school_admin" ||
          role === "designer" ||
          role === "super_admin") && (
          <Link
            href="/requests"
            className="block rounded-lg border border-zinc-900 bg-zinc-900 p-4 text-white transition-colors hover:bg-zinc-800 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <p className="text-sm font-medium">Open requests →</p>
            <p className="mt-1 text-xs opacity-80">
              {role === "school_admin"
                ? "Approve drafts, see what's in flight."
                : role === "teacher"
                  ? "Raise a new one or check your drafts."
                  : role === "designer"
                    ? "See requests across your assigned schools."
                    : "Cross-client view of every request."}
            </p>
          </Link>
        )}

        {(role === "designer" ||
          role === "school_admin" ||
          role === "super_admin") && (
          <Link
            href="/calendar"
            className="block rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <p className="text-sm font-medium">Monthly calendar →</p>
            <p className="mt-1 text-xs text-zinc-500">
              {role === "designer"
                ? "Plan the month's posts and slots."
                : role === "school_admin"
                  ? "Review the month's plan; approve what should go out."
                  : "Plan + approve across every school."}
            </p>
          </Link>
        )}

        {role === "decision_maker" && (
          <>
            <Link
              href="/calendar"
              className="block rounded-lg border border-zinc-900 bg-zinc-900 p-4 text-white transition-colors hover:bg-zinc-800 dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              <p className="text-sm font-medium">Monthly calendar →</p>
              <p className="mt-1 text-xs opacity-80">
                What's coming up for your school.
              </p>
            </Link>
            <Link
              href="/feed"
              className="block rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              <p className="text-sm font-medium">Published posts →</p>
              <p className="mt-1 text-xs text-zinc-500">
                Every post that's gone live, with links.
              </p>
            </Link>
          </>
        )}

        {role === "super_admin" && (
          <Link
            href="/admin"
            className="block rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            <p className="text-sm font-medium">Manage agency →</p>
            <p className="mt-1 text-xs text-zinc-500">
              Add schools, invite users, assign designers.
            </p>
          </Link>
        )}

        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
