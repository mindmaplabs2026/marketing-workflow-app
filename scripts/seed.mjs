// Seeds dev/test data using the Supabase service_role key.
// Idempotent: re-running creates missing users / school and re-syncs roles + memberships.
//
// Run from repo root:
//   node scripts/seed.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(here, "..", ".env.local"), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const sk = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

const supabase = createClient(url, sk, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SCHOOL_NAME = "Test School";

const TEST_USERS = [
  {
    email: "abhishek@mindmaplabs.in",
    password: "TestSchoolAdmin-2026",
    full_name: "Sam Principal",
    role: "school_admin",
  },
  {
    email: "teacher@test.local",
    password: "TestTeacher-2026",
    full_name: "Tara Teacher",
    role: "teacher",
  },
  {
    email: "designer@test.local",
    password: "TestDesigner-2026",
    full_name: "Dev Designer",
    role: "designer",
  },
  {
    email: "viewer@test.local",
    password: "TestViewer-2026",
    full_name: "Vince Viewer",
    role: "decision_maker",
  },
];

async function upsertSchool(name) {
  const { data: existing } = await supabase
    .from("schools")
    .select("id, name")
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("schools")
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function upsertUser({ email, password, full_name, role }) {
  // Look up existing auth user by listing (no direct email lookup in admin API).
  const { data: list, error: listErr } =
    await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listErr) throw listErr;
  let user = list.users.find((u) => u.email === email);

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (error) throw error;
    user = data.user;
  } else {
    // Reset password to keep the README accurate even if it was changed later.
    await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
  }

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ full_name, role })
    .eq("id", user.id);
  if (roleErr) throw roleErr;

  return user;
}

async function ensureMembership(schoolId, userId) {
  const { error } = await supabase
    .from("school_members")
    .upsert(
      { school_id: schoolId, user_id: userId },
      { onConflict: "school_id,user_id", ignoreDuplicates: true },
    );
  if (error) throw error;
}

(async () => {
  console.log("→ school");
  const school = await upsertSchool(SCHOOL_NAME);
  console.log("  ", school.id, school.name);

  console.log("→ users");
  for (const spec of TEST_USERS) {
    const u = await upsertUser(spec);
    await ensureMembership(school.id, u.id);
    console.log("  ", spec.role.padEnd(15), spec.email);
  }

  console.log("\nDone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
