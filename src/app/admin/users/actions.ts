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

const SUPER_ADMIN_CAN_CREATE: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

const SCHOOL_ADMIN_CAN_CREATE: UserRole[] = ["teacher", "decision_maker"];

const SCHOOL_ROLES: UserRole[] = ["school_admin", "teacher", "decision_maker"];

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const MIN_PASSWORD_LENGTH = 8;

export type DeleteUserResult = { error?: string };

export async function deleteUser(
  formData: FormData,
): Promise<DeleteUserResult> {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Missing user_id." };

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
    return { error: "Only super admins can delete users." };
  }
  if (user.id === userId) {
    return { error: "You can't delete yourself." };
  }

  const admin = createAdminClient();

  // Preflight the ON DELETE RESTRICT foreign keys on public.profiles.
  // GoTrue wraps the underlying Postgres FK error as the opaque string
  // "Database error deleting user", which the user-facing message can't
  // explain — so detect the real blockers ourselves first. Table names
  // mirror migrations 0001 lines 154/183/201/219/246.
  const [
    requestsRes,
    requestUploadsRes,
    designsRes,
    calendarItemsRes,
    publishedLinksRes,
  ] = await Promise.all([
    admin
      .from("requests")
      .select("id", { head: true, count: "exact" })
      .eq("created_by", userId),
    admin
      .from("request_uploads")
      .select("id", { head: true, count: "exact" })
      .eq("uploaded_by", userId),
    admin
      .from("designs")
      .select("id", { head: true, count: "exact" })
      .eq("uploaded_by", userId),
    admin
      .from("calendar_items")
      .select("id", { head: true, count: "exact" })
      .eq("created_by", userId),
    admin
      .from("published_links")
      .select("id", { head: true, count: "exact" })
      .eq("posted_by", userId),
  ]);

  const blockers: string[] = [];
  const noun = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;
  if (requestsRes.count) blockers.push(noun(requestsRes.count, "request"));
  if (requestUploadsRes.count)
    blockers.push(noun(requestUploadsRes.count, "request upload"));
  if (designsRes.count) blockers.push(noun(designsRes.count, "design"));
  if (calendarItemsRes.count)
    blockers.push(noun(calendarItemsRes.count, "calendar item"));
  if (publishedLinksRes.count)
    blockers.push(noun(publishedLinksRes.count, "published link"));

  if (blockers.length > 0) {
    return {
      error: `This account still owns ${blockers.join(", ")}. Reassign or delete that work first, then try again.`,
    };
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    if (/violates foreign key|restrict/i.test(error.message)) {
      return {
        error:
          "This user has created requests, designs, or calendar items. Reassign or archive their work first.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/admin/users");
  return {};
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
  if (!user) throw new Error("Not signed in.");

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (callerProfile?.role !== "super_admin") {
    throw new Error("Only super admins can change user roles.");
  }
  if (user.id === userId) {
    throw new Error(
      "You can't change your own role here. Use SQL if you really mean to.",
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
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
  const callerRole = callerProfile?.role;
  if (callerRole !== "super_admin" && callerRole !== "school_admin") {
    return { error: "You don't have permission to add teammates." };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as UserRole;
  const password = String(formData.get("password") ?? "");
  const schoolId = String(formData.get("school_id") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email." };
  }
  if (!fullName) {
    return { error: "Enter their full name." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const allowedRoles =
    callerRole === "super_admin" ? SUPER_ADMIN_CAN_CREATE : SCHOOL_ADMIN_CAN_CREATE;
  if (!allowedRoles.includes(role)) {
    return { error: "You can't assign that role." };
  }

  const needsSchool = SCHOOL_ROLES.includes(role);

  // Resolve and validate the school. School-side roles must be attached
  // to a school at create time; school_admin callers can only attach to
  // schools they're a member of.
  if (needsSchool) {
    if (!schoolId) return { error: "Pick a school for this user." };
    const { data: schoolRow } = await supabase
      .from("schools")
      .select("id")
      .eq("id", schoolId)
      .maybeSingle<{ id: string }>();
    if (!schoolRow) return { error: "That school doesn't exist." };

    if (callerRole === "school_admin") {
      const { data: membership } = await supabase
        .from("school_members")
        .select("school_id")
        .eq("user_id", user.id)
        .eq("school_id", schoolId)
        .maybeSingle<{ school_id: string }>();
      if (!membership) {
        return { error: "You can only add users to your own school." };
      }
    }
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

  // Update via the admin client. School_admin callers can't satisfy the
  // profiles_update_any_as_super_admin RLS, and prevent_role_self_change
  // was extended in migration 0017 to allow service-role through.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({ role, password_set: false })
    .eq("id", newUserId);
  if (profileErr) {
    return { error: profileErr.message };
  }

  if (needsSchool) {
    const { error: memberErr } = await admin
      .from("school_members")
      .insert({ school_id: schoolId, user_id: newUserId });
    if (memberErr) {
      return {
        error: `User created, but couldn't attach to that school: ${memberErr.message}.`,
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
