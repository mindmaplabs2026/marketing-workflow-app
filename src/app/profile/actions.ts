"use server";

import { createClient } from "@/lib/supabase/server";

export type ChangePasswordState = { error?: string; success?: boolean };

const MIN_PASSWORD_LENGTH = 8;

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "You must be signed in to change your password." };
  }

  const { error: authErr } = await supabase.auth.updateUser({ password });
  if (authErr) {
    return { error: authErr.message };
  }

  // Keep password_set true for users who came in as school-side defaults
  // and used this page to actually set a password.
  await supabase
    .from("profiles")
    .update({ password_set: true })
    .eq("id", user.id);

  return { success: true };
}
