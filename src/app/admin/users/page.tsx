import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { InviteForm } from "./invite-form";
import { RoleSelect } from "./role-select";
import type { UserRole } from "@/lib/supabase/types";

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

export default async function UsersPage() {
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

      <InviteForm schools={schools} />

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Name / email</th>
              <th className="px-4 py-3">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {profiles.map((p) => {
              const email = emailById.get(p.id) || "(unknown email)";
              const isSelf = p.id === currentUser?.id;
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {p.full_name?.trim() || email}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
