import { createClient } from "@/lib/supabase/server";
import { AppShellChrome } from "./app-shell-chrome";
import { NotificationsBell } from "./notifications-bell";
import type { UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session — render the page directly. The proxy will redirect
  // anywhere protected before we get here; pages that need a user do
  // their own check.
  if (!user) return <>{children}</>;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single<{ role: UserRole; full_name: string | null }>();

  const role: UserRole = profile?.role ?? "teacher";
  const name = profile?.full_name?.trim() || user.email || "";
  const email = user.email ?? "";

  return (
    <AppShellChrome
      name={name}
      email={email}
      role={role}
      roleLabel={ROLE_LABELS[role]}
      notificationsBell={<NotificationsBell />}
    >
      {children}
    </AppShellChrome>
  );
}
