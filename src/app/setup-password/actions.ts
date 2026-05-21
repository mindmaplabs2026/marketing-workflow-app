"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SetupState = { error?: string };

const MIN_PASSWORD_LENGTH = 8;

export async function setPassword(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
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
    return { error: "You must be signed in to set a password." };
  }

  const { error: authErr } = await supabase.auth.updateUser({ password });
  if (authErr) {
    return { error: authErr.message };
  }

  const { error: dbErr } = await supabase
    .from("profiles")
    .update({ password_set: true })
    .eq("id", user.id);
  if (dbErr) {
    return { error: dbErr.message };
  }

  redirect("/");
}
