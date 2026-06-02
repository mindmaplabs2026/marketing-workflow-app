#!/usr/bin/env node
// One-time migration helper: every profile with password_set=false gets
// a default temp password and a credentials email. They'll be forced
// through /change-password on next sign-in like any newly-added user.
//
// Run from project root:
//   node --env-file=.env.local scripts/seed-existing-passwords.mjs
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_APP_URL.
//
// The script is idempotent in spirit but it will issue a new password
// each run, invalidating the prior one. Run it once, then leave it.

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const DEFAULT_PASSWORD = "ChangeMe@2026";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

const missing = [];
if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (!RESEND_KEY) missing.push("RESEND_API_KEY");
if (!EMAIL_FROM) missing.push("EMAIL_FROM");
if (!APP_URL) missing.push("NEXT_PUBLIC_APP_URL");
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  console.error(
    "Tip: run with `node --env-file=.env.local scripts/seed-existing-passwords.mjs`",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const resend = new Resend(RESEND_KEY);

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmail(fullName, email, password) {
  const loginUrl = `${APP_URL.replace(/\/$/, "")}/login`;
  const subject = "Your Marketing Workflow account is ready";
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#fafafa;margin:0;padding:24px">
  <table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:24px">
    <tr><td>
      <p style="margin:0;color:#52525b;font-size:13px">Marketing Workflow</p>
      <h1 style="margin:8px 0 4px;font-size:20px;color:#18181b">Hi ${escapeHtml(fullName)},</h1>
      <p style="margin:0 0 16px;color:#52525b;font-size:14px">
        Sign-in just moved to email + password. Here&rsquo;s your account.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:16px;margin:0 0 16px">
        <tr><td style="padding:4px 0;color:#71717a;font-size:12px;width:100px">Email</td>
          <td style="padding:4px 0;color:#18181b;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(email)}</td></tr>
        <tr><td style="padding:4px 0;color:#71717a;font-size:12px">Password</td>
          <td style="padding:4px 0;color:#18181b;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(password)}</td></tr>
      </table>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#7c3aed;color:#fafafa;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:500;font-size:14px">
          Sign in &rarr;
        </a>
      </p>
      <p style="margin:0;color:#52525b;font-size:13px">
        <strong>Please change your password after first login.</strong> You&rsquo;ll be prompted to do it as soon as you sign in.
      </p>
    </td></tr>
  </table>
</body></html>`;
  const text = `Hi ${fullName},

Sign-in just moved to email + password. Here's your account.

Email: ${email}
Password: ${password}

Sign in: ${loginUrl}

Please change your password after first login. You'll be prompted to do it as soon as you sign in.`;
  return { subject, html, text };
}

async function main() {
  console.log(`Seeding default password "${DEFAULT_PASSWORD}" for legacy users…\n`);

  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("password_set", false);
  if (profErr) {
    console.error("Could not query profiles:", profErr.message);
    process.exit(1);
  }
  if (!profiles?.length) {
    console.log("No users with password_set=false. Nothing to do.");
    return;
  }

  console.log(`Found ${profiles.length} user${profiles.length === 1 ? "" : "s"}:\n`);

  let ok = 0;
  let fail = 0;
  for (const p of profiles) {
    const { data: authUser, error: authErr } =
      await supabase.auth.admin.getUserById(p.id);
    if (authErr || !authUser?.user?.email) {
      console.error(`  [skip] ${p.id} — could not resolve email`);
      fail++;
      continue;
    }
    const email = authUser.user.email;
    const fullName = p.full_name?.trim() || email;

    const { error: updErr } = await supabase.auth.admin.updateUserById(p.id, {
      password: DEFAULT_PASSWORD,
    });
    if (updErr) {
      console.error(`  [fail] ${email} — ${updErr.message}`);
      fail++;
      continue;
    }

    const { subject, html, text } = renderEmail(fullName, email, DEFAULT_PASSWORD);
    const { error: sendErr } = await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject,
      html,
      text,
    });
    if (sendErr) {
      console.error(`  [partial] ${email} — password set, but email send failed: ${sendErr.message}`);
      fail++;
      continue;
    }

    console.log(`  [ok] ${email}`);
    ok++;
  }

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
