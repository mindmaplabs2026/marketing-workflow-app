import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import type { UserRole } from "@/lib/supabase/types";
import { PasswordSection } from "./password-section";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const SCHOOL_ROLES: UserRole[] = ["teacher", "school_admin", "decision_maker"];

type SchoolLite = { id: string; name: string };
type MembershipRow = { schools: SchoolLite | null };

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export default async function ProfilePage() {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  let schools: SchoolLite[] = [];
  if (SCHOOL_ROLES.includes(session.role)) {
    const { data } = await supabase
      .from("school_members")
      .select("schools ( id, name )")
      .eq("user_id", session.id)
      .returns<MembershipRow[]>();
    schools = (data ?? [])
      .map((m) => m.schools)
      .filter((s): s is SchoolLite => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const displayName = session.full_name?.trim() || session.email;
  const initials = initialsFor(session.full_name ?? "", session.email);
  const roleLabel = ROLE_LABELS[session.role];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Profile
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            Your account
          </h1>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-zinc-900 text-base font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-medium text-zinc-900 dark:text-zinc-50">
                {displayName}
              </p>
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {session.email}
              </p>
              <span className="mt-1 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Account details
          </h2>
          <dl className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid grid-cols-3 gap-2 px-4 py-3">
              <dt className="text-sm text-zinc-500">Full name</dt>
              <dd className="col-span-2 text-sm text-zinc-900 dark:text-zinc-50">
                {session.full_name?.trim() || "—"}
              </dd>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 py-3">
              <dt className="text-sm text-zinc-500">Email</dt>
              <dd className="col-span-2 break-all text-sm text-zinc-900 dark:text-zinc-50">
                {session.email}
              </dd>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 py-3">
              <dt className="text-sm text-zinc-500">Role</dt>
              <dd className="col-span-2 text-sm text-zinc-900 dark:text-zinc-50">
                {roleLabel}
              </dd>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 py-3">
              <dt className="text-sm text-zinc-500">Joined</dt>
              <dd className="col-span-2 text-sm text-zinc-900 dark:text-zinc-50">
                {formatDate(authUser?.created_at)}
              </dd>
            </div>
            {authUser?.last_sign_in_at && (
              <div className="grid grid-cols-3 gap-2 px-4 py-3">
                <dt className="text-sm text-zinc-500">Last sign-in</dt>
                <dd className="col-span-2 text-sm text-zinc-900 dark:text-zinc-50">
                  {formatDate(authUser.last_sign_in_at)}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {schools.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Schools
            </h2>
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {schools.map((s) => (
                <li
                  key={s.id}
                  className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-50"
                >
                  {s.name}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Password
          </h2>
          <PasswordSection passwordSet={session.password_set} />
        </section>

        <section>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Sign out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
