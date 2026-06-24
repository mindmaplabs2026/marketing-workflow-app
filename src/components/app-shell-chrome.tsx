"use client";

import Link from "next/link";
import { AppSidebar } from "./app-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { NavigationFeedback } from "./navigation-feedback";
import { UserMenu } from "./user-menu";
import type { UserRole } from "@/lib/supabase/types";

export function AppShellChrome({
  name,
  email,
  role,
  roleLabel,
  notificationsBell,
  children,
}: {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  notificationsBell: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <NavigationFeedback />
      <header
        className="sticky top-0 z-50 flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white/80 px-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-4"
        style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-600 to-violet-700 text-xs font-bold text-white shadow-sm">
            M
          </span>
          <span>Mindmap Workflow</span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {notificationsBell}
          <UserMenu name={name} email={email} roleLabel={roleLabel} />
        </div>
      </header>

      <div className="flex flex-1">
        <AppSidebar role={role} />
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
