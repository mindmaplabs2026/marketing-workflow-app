import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AlreadySetNotice } from "./already-set-notice";
import { SetupPasswordForm } from "./setup-password-form";

export default async function SetupPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Re-entry after the password was already saved: don't offer the form
  // again. Show a friendly "already done" notice with a link onward.
  const { data: profile } = await supabase
    .from("profiles")
    .select("password_set")
    .eq("id", user.id)
    .single();

  if (profile?.password_set) {
    return <AlreadySetNotice email={user.email ?? ""} />;
  }

  return <SetupPasswordForm email={user.email ?? ""} />;
}
