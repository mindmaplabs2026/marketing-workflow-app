import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { NotificationsBell } from "@/components/notifications-bell";
import type { UserRole } from "@/lib/supabase/types";

const NAV = [
  { href: "/admin/pipeline", label: "Pipeline" },
  { href: "/admin/schools", label: "Schools" },
  { href: "/admin/users", label: "Users" },
];

export default async function AdminLayout({
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

  if (profile?.role !== "super_admin") {
    redirect("/?denied=1");
  }

  return (
    <div className="flex flex-1 bg-zinc-50 dark:bg-zinc-950">
      <aside className="flex w-56 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-4 py-5 dark:border-zinc-800">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Admin
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {profile?.full_name?.trim() || user.email}
            </p>
          </div>
          <NotificationsBell />
        </div>

        <nav className="flex-1 space-y-1 px-2 py-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="space-y-1 border-t border-zinc-200 px-2 py-3 dark:border-zinc-800">
          <Link
            href="/"
            className="block rounded-md px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            ← Back to app
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-10">{children}</div>
      </div>
    </div>
  );
}
