import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteSchool, renameSchool } from "../actions";
import { removeMember } from "./actions";
import { AddMemberForm } from "./add-member-form";
import type { UserRole } from "@/lib/supabase/types";

type SchoolRow = { id: string; name: string };

type MemberRow = {
  id: string;
  user_id: string;
  created_at: string;
  profiles: {
    id: string;
    full_name: string | null;
    role: UserRole;
  } | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
};

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

export default async function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: schoolId } = await params;

  const supabase = await createClient();
  const adminClient = createAdminClient();

  const [schoolRes, membersRes, allProfilesRes, authListRes] =
    await Promise.all([
      supabase
        .from("schools")
        .select("id, name")
        .eq("id", schoolId)
        .single<SchoolRow>(),
      supabase
        .from("school_members")
        .select(
          "id, user_id, created_at, profiles ( id, full_name, role )",
        )
        .eq("school_id", schoolId)
        .order("created_at", { ascending: true })
        .returns<MemberRow[]>(),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .returns<ProfileRow[]>(),
      adminClient.auth.admin.listUsers({ perPage: 200 }),
    ]);

  if (!schoolRes.data) notFound();
  const school = schoolRes.data;
  const members = membersRes.data ?? [];
  const allProfiles = allProfilesRes.data ?? [];
  const emailById = new Map(
    (authListRes.data?.users ?? []).map((u) => [u.id, u.email ?? ""]),
  );

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const candidates = allProfiles.filter(
    (p) => !memberUserIds.has(p.id) && p.role !== "super_admin",
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/admin/schools"
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← All schools
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {school.name}
          </h1>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Rename
        </h2>
        <form action={renameSchool} className="flex items-center gap-2">
          <input type="hidden" name="id" value={school.id} />
          <input
            name="name"
            defaultValue={school.name}
            required
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Save
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Members ({members.length})
          </h2>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-zinc-500">No members yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {members.map((m) => {
              const email = emailById.get(m.user_id) || "(unknown email)";
              const name = m.profiles?.full_name?.trim() || email;
              const role = m.profiles?.role ?? "teacher";
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {email} · {ROLE_LABELS[role]}
                    </p>
                  </div>
                  <form action={removeMember}>
                    <input type="hidden" name="member_id" value={m.id} />
                    <input type="hidden" name="school_id" value={school.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Remove
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <AddMemberForm
          schoolId={school.id}
          candidates={candidates.map((p) => ({
            id: p.id,
            label: `${(p.full_name?.trim() || emailById.get(p.id) || p.id)} · ${ROLE_LABELS[p.role]}`,
          }))}
        />
      </section>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-red-600 dark:text-red-400">
          Danger zone
        </h2>
        <form action={deleteSchool}>
          <input type="hidden" name="id" value={school.id} />
          <button
            type="submit"
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            Delete school
          </button>
        </form>
        <p className="text-xs text-zinc-500">
          Deletes the school and removes all member assignments. Requests and
          calendar items linked to this school are blocked from deletion
          (handled by FK restrict).
        </p>
      </section>
    </div>
  );
}
