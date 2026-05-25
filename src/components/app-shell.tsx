import { redirect } from "next/navigation";
import { headers } from "next/headers";
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

  // No session — bounce to /login. The proxy already redirects most
  // protected paths, but the native (Capacitor) PKCE flow can land us
  // here once with no cookies yet; rendering bare children would show
  // a chrome-less home page with no way to navigate.
  if (!user) {
    const pathname = (await headers()).get("x-pathname") ?? "/";
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    redirect(`/login${next}`);
  }

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
