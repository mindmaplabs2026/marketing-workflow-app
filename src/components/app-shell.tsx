import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/supabase/auth";
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
  const session = await getSessionUser();

  // No session — bounce to /login. The proxy already redirects most
  // protected paths, but the native (Capacitor) PKCE flow can land us
  // here once with no cookies yet; rendering bare children would show
  // a chrome-less home page with no way to navigate.
  if (!session) {
    const pathname = (await headers()).get("x-pathname") ?? "/";
    const next = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    redirect(`/login${next}`);
  }

  const name = session.full_name?.trim() || session.email;

  return (
    <AppShellChrome
      name={name}
      email={session.email}
      role={session.role}
      roleLabel={ROLE_LABELS[session.role]}
      notificationsBell={<NotificationsBell />}
    >
      {children}
    </AppShellChrome>
  );
}
