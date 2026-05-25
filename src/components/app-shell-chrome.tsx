"use client";

import Link from "next/link";
import { useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <header
        className="sticky top-0 z-50 flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white/80 px-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-4"
        style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 md:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white dark:bg-zinc-50 dark:text-zinc-900">
              M
            </span>
            <span className="hidden sm:inline">Mindmap Workflow</span>
            <span className="sm:hidden">Mindmap</span>
          </Link>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          {notificationsBell}
          <UserMenu name={name} email={email} roleLabel={roleLabel} />
        </div>
      </header>

      <div className="flex flex-1">
        <AppSidebar role={role} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      <MobileBottomNav role={role} />
    </div>
  );
}
