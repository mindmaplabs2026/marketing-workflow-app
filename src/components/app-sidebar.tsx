"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/supabase/types";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
    </svg>
  );
}
function RequestsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}
function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M4 5h12v14H4zM18 9h2v10h-2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M7 9h6M7 13h6M7 17h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}
function NotifIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M10 20a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: <HomeIcon />,
    roles: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  },
  {
    href: "/requests",
    label: "Requests",
    icon: <RequestsIcon />,
    roles: ["super_admin", "designer", "school_admin", "teacher"],
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: <CalendarIcon />,
    roles: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  },
  {
    href: "/feed",
    label: "Published",
    icon: <FeedIcon />,
    roles: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: <NotifIcon />,
    roles: ["super_admin", "designer", "school_admin", "teacher", "decision_maker"],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function AppSidebar({
  role,
  name,
  email,
  roleLabel,
}: {
  role: UserRole;
  name: string;
  email: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => item.roles.includes(role));
  const display = name.trim() || email;
  const initials = initialsFor(name, email);
  const profileHref =
    role === "super_admin" || role === "school_admin" ? "/admin" : "/profile";
  const profileActive = isActive(pathname, profileHref);

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:block">
      <nav className="flex h-full flex-col overflow-y-auto px-3 py-4">
        <div className="flex-1 space-y-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-3 overflow-hidden rounded-md px-3 py-2 text-sm font-medium transition-all duration-200 ease-out ${
                  active
                    ? "bg-violet-600 text-white shadow-sm shadow-violet-600/20 dark:bg-violet-500 dark:shadow-violet-950/30"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full transition-all duration-200 motion-reduce:transition-none ${
                    active
                      ? "bg-white/90 opacity-100 dark:bg-white"
                      : "bg-violet-500 opacity-0 group-hover:opacity-60"
                  }`}
                />
                <span
                  className={`relative z-10 transition-transform duration-200 motion-reduce:transform-none motion-reduce:transition-none ${
                    active
                      ? "translate-x-0.5"
                      : "text-zinc-500 group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:text-zinc-400 dark:group-hover:text-zinc-200"
                  }`}
                >
                  {item.icon}
                </span>
                <span className="relative z-10">{item.label}</span>
              </Link>
            );
          })}
        </div>

        <Link
          href={profileHref}
          className={`group mt-4 flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none ${
            profileActive
              ? "border-violet-200 bg-violet-50 text-violet-950 shadow-sm shadow-violet-100 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100"
              : "border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-white dark:text-zinc-200 dark:hover:border-zinc-800 dark:hover:bg-zinc-950/40"
          }`}
        >
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-sm font-semibold text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-950">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
              {display}
            </span>
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {roleLabel}
            </span>
          </span>
          <span className="text-zinc-400 transition-transform group-hover:translate-x-0.5">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </Link>
      </nav>
    </aside>
  );
}
