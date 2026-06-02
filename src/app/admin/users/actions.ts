"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, emailFrom, resendClient } from "@/lib/email/client";
import type { UserRole } from "@/lib/supabase/types";

const VALID_ROLES: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

const CREATABLE_ROLES: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

const SCHOOL_ROLES: UserRole[] = ["school_admin", "teacher", "decision_maker"];

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const MIN_PASSWORD_LENGTH = 8;

export async function deleteUser(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) throw new Error("Missing user_id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (callerProfile?.role !== "super_admin") {
    throw new Error("Only super admins can delete users.");
  }
  if (user.id === userId) {
    throw new Error("You can't delete yourself.");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    if (/violates foreign key|restrict/i.test(error.message)) {
      throw new Error(
        "Can't delete — this user has created requests, designs, or calendar items. Reassign or archive their work first.",
      );
    }
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

export async function updateUserRole(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!userId || !VALID_ROLES.includes(role)) {
    throw new Error("Invalid input.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    throw new Error(
      "You can't change your own role here. Use SQL if you really mean to.",
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
}

export type CreateUserState = {
  error?: string;
  success?: boolean;
  email?: string;
};

export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (callerProfile?.role !== "super_admin") {
    return { error: "Only super admins can add teammates." };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as UserRole;
  const password = String(formData.get("password") ?? "");

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email." };
  }
  if (!fullName) {
    return { error: "Enter their full name." };
  }
  if (!CREATABLE_ROLES.includes(role)) {
    return { error: "Pick a role." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const needsSchool = SCHOOL_ROLES.includes(role);
  const schoolId = String(formData.get("school_id") ?? "").trim();
  if (needsSchool) {
    if (!schoolId) return { error: "Pick a school for this user." };
    const { data: schoolRow, error: schoolErr } = await supabase
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .maybeSingle<{ id: string }>();
    if (schoolErr) return { error: schoolErr.message };
    if (!schoolRow) return { error: "That school doesn't exist." };
  }

  const admin = createAdminClient();

  // email_confirm: true skips Supabase's verification email. The
  // handle_new_user trigger fires on insert into auth.users and creates
  // a profile row with default role=teacher + password_set=true.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createErr || !created?.user) {
    if (createErr && /already.*(registered|exist)/i.test(createErr.message)) {
      return { error: "That email already has an account." };
    }
    return { error: createErr?.message ?? "Could not create the user." };
  }

  const newUserId = created.user.id;

  // Promote the auto-created profile to the chosen role and flag the
  // account so the proxy forces a password change on first login. Done
  // with the super admin's own session so prevent_role_self_change
  // (which allows role changes when the caller is super_admin) is happy.
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ role, password_set: false })
    .eq("id", newUserId);
  if (profileErr) {
    return { error: profileErr.message };
  }

  if (needsSchool) {
    const { error: memberErr } = await supabase
      .from("school_members")
      .insert({ school_id: schoolId, user_id: newUserId });
    if (memberErr) {
      return {
        error: `User created, but couldn't attach to that school: ${memberErr.message}. Add them at /admin/schools/${schoolId}.`,
      };
    }
  }

  const resend = resendClient();
  if (!resend) {
    return { error: "Email isn't configured. Set RESEND_API_KEY first." };
  }

  const { subject, html, text } = renderCredentialsEmail(
    fullName,
    email,
    password,
    role,
  );

  try {
    const { error: sendErr } = await resend.emails.send({
      from: emailFrom(),
      to: email,
      subject,
      html,
      text,
    });
    if (sendErr) {
      const isSandbox = /testing.*email|sandbox|verify.*domain/i.test(
        sendErr.message,
      );
      if (isSandbox) {
        return {
          error: `User created but the credentials email was not sent — Resend is in sandbox mode. Verify a domain at resend.com/domains and update EMAIL_FROM. Share the password with the user manually for now.`,
        };
      }
      return { error: sendErr.message };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Email send failed." };
  }

  revalidatePath("/admin/users");
  return { success: true, email };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCredentialsEmail(
  fullName: string,
  email: string,
  password: string,
  role: UserRole,
): { subject: string; html: string; text: string } {
  const roleLabel = ROLE_LABEL[role];
  const loginUrl = `${appUrl()}/login`;
  const subject = "Your Marketing Workflow account is ready";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#fafafa;margin:0;padding:24px">
  <table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:24px">
    <tr><td>
      <p style="margin:0;color:#52525b;font-size:13px">Marketing Workflow</p>
      <h1 style="margin:8px 0 4px;font-size:20px;color:#18181b">Hi ${escapeHtml(fullName)},</h1>
      <p style="margin:0 0 16px;color:#52525b;font-size:14px">
        You&rsquo;ve been added to the workspace as a <strong>${escapeHtml(roleLabel)}</strong>. Use the email and password below to sign in.
      </p>
      <table cellpadding="0" cellspacing="0" style="width:100%;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:16px;margin:0 0 16px">
        <tr>
          <td style="padding:4px 0;color:#71717a;font-size:12px;width:100px">Email</td>
          <td style="padding:4px 0;color:#18181b;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(email)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#71717a;font-size:12px">Password</td>
          <td style="padding:4px 0;color:#18181b;font-size:14px;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(password)}</td>
        </tr>
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

You've been added to the Marketing Workflow as a ${roleLabel}.

Email: ${email}
Password: ${password}

Sign in: ${loginUrl}

Please change your password after first login. You'll be prompted to do it as soon as you sign in.`;

  return { subject, html, text };
}
