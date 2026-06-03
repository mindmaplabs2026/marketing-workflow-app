#!/usr/bin/env node
// One-off helper: reset a single user's password to ChangeMe@2026 and
// force them through /change-password on next sign-in. Use when a user
// can't log in (lost password, email never reached them, etc.).
//
// Run from project root:
//   node --env-file=.env.local scripts/reset-user-password.mjs <email>
//
// Example:
//   node --env-file=.env.local scripts/reset-user-password.mjs trainersandeepkumar@gmail.com
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

const DEFAULT_PASSWORD = "ChangeMe@2026";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: node --env-file=.env.local scripts/reset-user-password.mjs <email>");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 200 });
if (listErr) {
  console.error("Could not list users:", listErr.message);
  process.exit(1);
}

const user = list.users.find((u) => (u.email ?? "").toLowerCase() === email);
if (!user) {
  console.error(`No user found with email ${email}.`);
  process.exit(1);
}

const { error: updErr } = await supabase.auth.admin.updateUserById(user.id, {
  password: DEFAULT_PASSWORD,
});
if (updErr) {
  console.error(`Failed to set password: ${updErr.message}`);
  process.exit(1);
}

const { error: flagErr } = await supabase
  .from("profiles")
  .update({ password_set: false })
  .eq("id", user.id);
if (flagErr) {
  console.warn(
    `Password was reset, but failed to flip password_set=false: ${flagErr.message}`,
  );
  console.warn("User can log in but won't be auto-prompted to change password.");
} else {
  console.log(`OK — ${email} password reset.`);
  console.log(`\n  Email:    ${email}`);
  console.log(`  Password: ${DEFAULT_PASSWORD}`);
  console.log(`\n  On first sign-in the user will be forced through /change-password.`);
}
