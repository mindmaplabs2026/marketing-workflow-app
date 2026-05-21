// One-off: rename Sam Principal's auth email so Resend sandbox emails
// land in a real inbox. Idempotent — re-running once the user is
// already on the new email is a no-op.
//
// Usage:
//   node scripts/change-school-admin-email.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(here, "..", ".env.local"), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const sk = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();

const OLD_EMAIL = "school.admin@test.local";
const NEW_EMAIL = "abhishek@mindmaplabs.in";

const supabase = createClient(url, sk, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: list, error: listErr } =
  await supabase.auth.admin.listUsers({ perPage: 200 });
if (listErr) throw listErr;

const alreadyNew = list.users.find((u) => u.email === NEW_EMAIL);
if (alreadyNew) {
  console.log(`OK ${NEW_EMAIL} already exists (user id: ${alreadyNew.id}) — nothing to do.`);
  process.exit(0);
}

const user = list.users.find((u) => u.email === OLD_EMAIL);
if (!user) {
  console.error(`No user found with email ${OLD_EMAIL}.`);
  process.exit(1);
}

const { error: updErr } = await supabase.auth.admin.updateUserById(user.id, {
  email: NEW_EMAIL,
  email_confirm: true,
});
if (updErr) throw updErr;

console.log(`OK Renamed ${OLD_EMAIL} -> ${NEW_EMAIL} (user id: ${user.id})`);
console.log("Log in with the new email + the same TestSchoolAdmin-2026 password.");
