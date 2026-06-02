import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("password_set")
    .eq("id", user.id)
    .single();

  // This page is the forced first-login step. Anyone who already has
  // password_set=true is here by accident (bookmark / back button) — send
  // them to the workspace. The general "change my password later" flow
  // lives on /profile.
  if (profile?.password_set) {
    redirect("/");
  }

  return <ChangePasswordForm email={user.email ?? ""} />;
}
