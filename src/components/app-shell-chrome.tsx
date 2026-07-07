"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppSidebar } from "./app-sidebar";
import { HeaderSearch } from "./header-search";
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
  const pathname = usePathname();
  const isMobileFocusedRequestDetail =
    /^\/requests\/[^/]+$/.test(pathname);

  return (
    <div className="flex min-h-full flex-col bg-slate-50 dark:bg-zinc-950">
      <NavigationFeedback />
      <header
        className={`sticky top-0 z-50 h-14 items-center justify-between gap-3 border-b border-white/70 bg-white/78 px-3 shadow-[0_1px_0_rgba(15,23,42,0.04),0_10px_40px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-4 ${
          isMobileFocusedRequestDetail ? "hidden md:flex" : "flex"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3.5rem + env(safe-area-inset-top))" }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-[-0.005em] text-slate-950 dark:text-zinc-50"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-violet-700 text-xs font-bold text-white shadow-lg shadow-violet-200/70 ring-1 ring-violet-300/40">
            M
          </span>
          <span>Mindmap Workflow</span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <HeaderSearch />
          {notificationsBell}
          <UserMenu name={name} email={email} roleLabel={roleLabel} />
        </div>
      </header>

      <div className="flex flex-1">
        <AppSidebar
          role={role}
          name={name}
          email={email}
          roleLabel={roleLabel}
        />
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>

      {!isMobileFocusedRequestDetail && <MobileBottomNav role={role} />}
    </div>
  );
}
