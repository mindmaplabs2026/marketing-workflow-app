import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import type { UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

export default async function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single<{ role: UserRole; full_name: string | null }>();

  const role: UserRole = profile?.role ?? "teacher";
  const name = profile?.full_name?.trim() || user.email || "";

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/feed"
              className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              Published
            </Link>
            <Link
              href="/calendar"
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Calendar
            </Link>
            {role !== "decision_maker" && (
              <Link
                href="/requests"
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Requests
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="hidden sm:inline">
              {name} · {ROLE_LABELS[role]}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
          {children}
        </div>
      </div>
    </div>
  );
}
