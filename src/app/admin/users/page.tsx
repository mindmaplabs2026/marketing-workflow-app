import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AddUserForm } from "./add-user-form";
import { RoleSelect } from "./role-select";
import { DeleteUserButton } from "./delete-user-button";
import type { UserRole } from "@/lib/supabase/types";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

const PAGE_SIZE = 10;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page = "1" } = await searchParams;
  const query = q.trim();
  const queryLower = query.toLowerCase();
  const requestedPage = Math.max(1, parseInt(page, 10) || 1);

  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();

  const [profilesRes, authListRes, schoolsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: true })
      .returns<ProfileRow[]>(),
    adminClient.auth.admin.listUsers({ perPage: 200 }),
    supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>(),
  ]);

  const profiles = profilesRes.data ?? [];
  const emailById = new Map(
    (authListRes.data?.users ?? []).map((u) => [u.id, u.email ?? ""]),
  );
  const schools = schoolsRes.data ?? [];

  const filtered = queryLower
    ? profiles.filter((p) => {
        const email = emailById.get(p.id) ?? "";
        return (
          (p.full_name ?? "").toLowerCase().includes(queryLower) ||
          email.toLowerCase().includes(queryLower)
        );
      })
    : profiles;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(requestedPage, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Users
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {profiles.length} signed up. New signups default to{" "}
          <span className="font-medium">Teacher</span>; change roles here.
        </p>
      </div>

      <AddUserForm schools={schools} />

      <form
        method="get"
        action="/admin/users"
        className="flex items-center gap-2"
      >
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Search by name or email…"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Search
        </button>
        {query && (
          <Link
            href="/admin/users"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Clear
          </Link>
        )}
      </form>

      {query && (
        <p className="-mt-3 text-xs text-zinc-500">
          {filtered.length} result{filtered.length === 1 ? "" : "s"} for &ldquo;
          {query}&rdquo;
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name / email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-sm text-zinc-500"
                >
                  No users match that search.
                </td>
              </tr>
            )}
            {pageRows.map((p) => {
              const email = emailById.get(p.id) || "(unknown email)";
              const isSelf = p.id === currentUser?.id;
              const label = p.full_name?.trim() || email;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {label}
                      {isSelf && (
                        <span className="ml-2 text-xs text-zinc-500">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <RoleSelect
                      userId={p.id}
                      currentRole={p.role}
                      disabled={isSelf}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && (
                      <DeleteUserButton userId={p.id} label={label} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            Page {safePage} of {totalPages} · {filtered.length} user
            {filtered.length === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-2">
            {safePage > 1 ? (
              <Link
                href={pageHref(safePage - 1)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                ← Previous
              </Link>
            ) : (
              <span className="rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
                ← Previous
              </span>
            )}
            {safePage < totalPages ? (
              <Link
                href={pageHref(safePage + 1)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-md border border-zinc-200 px-3 py-1 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-600">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
