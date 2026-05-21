import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetupPasswordForm } from "./setup-password-form";

export default async function SetupPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <SetupPasswordForm email={user.email ?? ""} />;
}
