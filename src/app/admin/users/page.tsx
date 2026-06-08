import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/auth";
import { AddUserForm } from "./add-user-form";
import { RoleSelect } from "./role-select";
import { DeleteUserButton } from "./delete-user-button";
import { ResetPasswordButton } from "./reset-password-button";
import { SearchInput } from "@/components/search-input";
import type { UserRole } from "@/lib/supabase/types";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

const PAGE_SIZE = 10;

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const SUPER_ADMIN_ROLES: UserRole[] = [
  "designer",
  "super_admin",
  "school_admin",
  "teacher",
  "decision_maker",
];
const SCHOOL_ADMIN_ROLES: UserRole[] = ["teacher", "decision_maker"];

// Roles a school_admin is allowed to manage in the user list (role edit +
// delete). Mirrors SCHOOL_ADMIN_CAN_MANAGE on the server.
const SCHOOL_ADMIN_MANAGEABLE: UserRole[] = ["teacher", "decision_maker"];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  const callerRole = session.role;
  const isSuperAdmin = callerRole === "super_admin";

  const { q = "", page = "1" } = await searchParams;
  const query = q.trim();
  const queryLower = query.toLowerCase();
  const requestedPage = Math.max(1, parseInt(page, 10) || 1);

  const supabase = await createClient();
  const adminClient = createAdminClient();

  // For school_admin: resolve the schools they belong to. The Add form
  // can only attach to these, and the users list is filtered to people
  // who share at least one school with them.
  let scopedSchoolIds: string[] = [];
  if (!isSuperAdmin) {
    const { data: my } = await supabase
      .from("school_members")
      .select("school_id")
      .eq("user_id", session.id)
      .returns<{ school_id: string }[]>();
    scopedSchoolIds = (my ?? []).map((r) => r.school_id);
  }

  const [profilesRes, authListRes, schoolsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, created_at")
      .order("created_at", { ascending: true })
      .returns<ProfileRow[]>(),
    adminClient.auth.admin.listUsers({ perPage: 200 }),
    isSuperAdmin
      ? supabase
          .from("schools")
          .select("id, name")
          .order("name", { ascending: true })
          .returns<{ id: string; name: string }[]>()
      : supabase
          .from("schools")
          .select("id, name")
          .in("id", scopedSchoolIds.length ? scopedSchoolIds : ["__none__"])
          .order("name", { ascending: true })
          .returns<{ id: string; name: string }[]>(),
  ]);

  const profiles = profilesRes.data ?? [];
  const emailById = new Map(
    (authListRes.data?.users ?? []).map((u) => [u.id, u.email ?? ""]),
  );
  const schools = schoolsRes.data ?? [];

  // School_admin view: keep only profiles that share a school with the
  // caller (or are the caller themselves). Done after the profiles fetch
  // so we can also include any super_admin/designer who happens to be in
  // one of the same school_members rows.
  let scopedProfiles = profiles;
  if (!isSuperAdmin) {
    const { data: members } = await supabase
      .from("school_members")
      .select("user_id")
      .in("school_id", scopedSchoolIds.length ? scopedSchoolIds : ["__none__"])
      .returns<{ user_id: string }[]>();
    const allowedIds = new Set((members ?? []).map((r) => r.user_id));
    allowedIds.add(session.id);
    scopedProfiles = profiles.filter((p) => allowedIds.has(p.id));
  }

  const filtered = queryLower
    ? scopedProfiles.filter((p) => {
        const email = emailById.get(p.id) ?? "";
        return (
          (p.full_name ?? "").toLowerCase().includes(queryLower) ||
          email.toLowerCase().includes(queryLower)
        );
      })
    : scopedProfiles;

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
          {isSuperAdmin
            ? `${scopedProfiles.length} signed up.`
            : `${scopedProfiles.length} in your school.`}
        </p>
      </div>

      <AddUserForm
        schools={schools}
        availableRoles={isSuperAdmin ? SUPER_ADMIN_ROLES : SCHOOL_ADMIN_ROLES}
      />

      <SearchInput
        initialValue={query}
        placeholder="Search by name or email…"
        resetParams={["page"]}
      />

      {query && (
        <p className="-mt-3 text-xs text-zinc-500">
          {filtered.length} result{filtered.length === 1 ? "" : "s"} for &ldquo;
          {query}&rdquo;
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[600px]">
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
              const isSelf = p.id === session.id;
              const label = p.full_name?.trim() || email;
              // A row is manageable (role-edit + delete) when the caller
              // has authority over the target. Super admins manage anyone
              // but themselves; school admins manage only teachers /
              // decision-makers in their own school (list is already
              // scoped to their school above).
              const canManage = isSelf
                ? false
                : isSuperAdmin
                  ? true
                  : SCHOOL_ADMIN_MANAGEABLE.includes(p.role);
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
                    {canManage ? (
                      <RoleSelect
                        userId={p.id}
                        currentRole={p.role}
                        availableRoles={
                          isSuperAdmin ? undefined : SCHOOL_ADMIN_MANAGEABLE
                        }
                      />
                    ) : (
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {ROLE_LABEL[p.role]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {canManage && isSuperAdmin && (
                        <ResetPasswordButton userId={p.id} label={label} />
                      )}
                      {canManage && (
                        <DeleteUserButton userId={p.id} label={label} />
                      )}
                    </div>
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
