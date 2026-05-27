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

const INVITABLE_ROLES: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

const INTERNAL_ROLES: UserRole[] = ["super_admin", "designer"];

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

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

export type InviteState = {
  error?: string;
  success?: boolean;
  email?: string;
};

export async function inviteUser(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
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
    return { error: "Only super admins can invite teammates." };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email." };
  }
  if (!fullName) {
    return { error: "Enter their full name." };
  }
  if (!INVITABLE_ROLES.includes(role)) {
    return { error: "Pick a role." };
  }

  const isInternal = INTERNAL_ROLES.includes(role);

  // School-side roles (school_admin / teacher / decision_maker) must be
  // attached to a school at invite time. Validate before we create the
  // auth user so we don't strand a user without a school assignment.
  const schoolId = String(formData.get("school_id") ?? "").trim();
  if (!isInternal) {
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

  // Create the auth user + grab the signed action link. Supabase fires our
  // handle_new_user trigger here, which inserts a profile row with the
  // default 'teacher' role and full_name pulled from raw_user_meta_data.
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        data: { full_name: fullName },
      },
    });
  if (linkErr || !linkData?.user) {
    if (linkErr && /already.*(registered|exist)/i.test(linkErr.message)) {
      return { error: "That email already has an account." };
    }
    return { error: linkErr?.message ?? "Could not create the invite." };
  }

  const newUserId = linkData.user.id;
  const hashedToken = linkData.properties?.hashed_token;
  if (!hashedToken) {
    return { error: "Supabase returned no token to email." };
  }
  const nextPath = isInternal ? "/setup-password" : "/";
  // Land on /auth/confirm-invite (not /auth/confirm) so that email-scanner
  // prefetches don't burn the single-use token before the human ever taps
  // the link — that interstitial only calls verifyOtp on POST.
  const actionLink = `${appUrl()}/auth/confirm-invite?token_hash=${hashedToken}&type=invite&next=${encodeURIComponent(nextPath)}`;

  // Promote the auto-created profile to the chosen role. Internal users
  // (designer / super_admin) need a password — flag them so the proxy
  // forces them through /setup-password on first sign-in. School users
  // (teacher / school_admin / decision_maker) stay on magic-link only, so
  // password_set keeps its default (true) and they skip the setup step.
  // Done with the super admin's own session so the prevent_role_self_change
  // trigger is happy (it allows role changes when the caller is super_admin).
  const profilePatch: { role: UserRole; password_set?: boolean } = { role };
  if (isInternal) profilePatch.password_set = false;
  const { error: profileErr } = await supabase
    .from("profiles")
    .update(profilePatch)
    .eq("id", newUserId);
  if (profileErr) {
    return { error: profileErr.message };
  }

  // Attach school-side users to the chosen school. The auth user + profile
  // already exist; if this insert errors we surface the message so the
  // super admin can finish it manually at /admin/schools/[id].
  if (!isInternal) {
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

  const { subject, html, text } = renderInviteEmail(
    fullName,
    actionLink,
    role,
    isInternal,
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
      const isSandbox =
        /testing.*email|sandbox|verify.*domain/i.test(sendErr.message);
      if (isSandbox) {
        return {
          error: `User created but invite email was not sent — Resend is in sandbox mode. To send emails to other addresses, verify a domain at resend.com/domains and update EMAIL_FROM. The user can be added to a school manually at /admin/schools.`,
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

function renderInviteEmail(
  fullName: string,
  link: string,
  role: UserRole,
  isInternal: boolean,
): { subject: string; html: string; text: string } {
  const roleLabel = ROLE_LABEL[role];
  const subject = "You've been added to the Marketing Workflow";

  const action = isInternal ? "Set your password" : "Open your workspace";
  const intro = isInternal
    ? "Click below to set a password and sign in."
    : "Click below to open your workspace. After this, you can sign back in any time by requesting a one-tap link at the sign-in page.";

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#fafafa;margin:0;padding:24px">
  <table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:24px">
    <tr><td>
      <p style="margin:0;color:#52525b;font-size:13px">Marketing Workflow</p>
      <h1 style="margin:8px 0 4px;font-size:20px;color:#18181b">Hi ${escapeHtml(fullName)},</h1>
      <p style="margin:0 0 16px;color:#52525b;font-size:14px">
        You&rsquo;ve been added to the workspace as a <strong>${escapeHtml(roleLabel)}</strong>. ${escapeHtml(intro)}
      </p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#18181b;color:#fafafa;padding:10px 16px;border-radius:6px;text-decoration:none">
          ${escapeHtml(action)} &rarr;
        </a>
      </p>
      <p style="margin:0;color:#a1a1aa;font-size:12px">
        This link expires after one use. If you weren&rsquo;t expecting this email, ignore it.
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text = `Hi ${fullName},

You've been added to the Marketing Workflow as a ${roleLabel}. ${intro}

${link}

This link expires after one use.`;

  return { subject, html, text };
}
