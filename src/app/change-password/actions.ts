"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = { error?: string };

const MIN_PASSWORD_LENGTH = 8;

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("new") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current) {
    return { error: "Enter your current password." };
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (next !== confirm) {
    return { error: "New passwords don't match." };
  }
  if (next === current) {
    return { error: "New password must be different from the current one." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { error: "You must be signed in." };
  }

  // Verify the current password by signing in again with the same email +
  // typed password. On a wrong password Supabase returns an error without
  // touching the existing session cookies; on success it issues fresh
  // cookies for the same user, which is harmless.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (verifyErr) {
    return { error: "Current password is incorrect." };
  }

  const { error: updateErr } = await supabase.auth.updateUser({
    password: next,
  });
  if (updateErr) {
    return { error: updateErr.message };
  }

  const { error: dbErr } = await supabase
    .from("profiles")
    .update({ password_set: true })
    .eq("id", user.id);
  if (dbErr) {
    return { error: dbErr.message };
  }

  // Bounce through /change-password/done. That page does a hard
  // window.location.replace("/?changed=password") so the root layout
  // re-renders with AppShell (a soft redirect from a shell-free route
  // leaves the cached chrome-less layout in place).
  redirect("/change-password/done");
}
