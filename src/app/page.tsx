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
  super_admin:
    "Phase 3 will give you a cross-client dashboard for all schools.",
  designer: "Phase 3 will give you a prioritized queue of assigned work.",
  school_admin:
    "Phase 4 will let you approve requests and review the monthly calendar.",
  teacher: "Phase 4 will let you raise requests and upload photos.",
  decision_maker:
    "Phase 4 will give you a read-only calendar of published updates.",
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
