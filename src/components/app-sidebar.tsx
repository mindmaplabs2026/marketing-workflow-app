"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
function TipPlaneIcon() {
  return (
    <svg viewBox="0 0 96 96" fill="none" className="h-20 w-20 drop-shadow-[0_16px_18px_rgba(124,58,237,0.22)]">
      <path
        d="M79.5 22.8 17.8 45.4c-3.4 1.2-3.4 5.9.1 7l21.2 6.7 7 21.1c1.1 3.4 5.8 3.5 7 .1l22.7-61.6c1-2.7-1.8-5.5-4.5-4.5Z"
        fill="url(#tipPlaneGradient)"
      />
      <path
        d="m39.1 59.1 24-24-16.9 45.1-7.1-21.1Z"
        fill="#6d28d9"
        fillOpacity="0.9"
      />
      <path
        d="m17.8 45.4 45.3-10.3-24 24-21.3-6.7c-3.4-1.1-3.5-5.8 0-7Z"
        fill="#8b5cf6"
      />
      <path d="m39.1 59.1 24-24" stroke="white" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="tipPlaneGradient" x1="18" y1="78" x2="78" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="0.52" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>
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
  const showRequestTip = isActive(pathname, "/requests");
  const showCalendarTip = isActive(pathname, "/calendar");
  const pathnameParts = pathname.split("/").filter(Boolean);
  const isRequestDetail =
    pathnameParts[0] === "requests" && pathnameParts.length === 2;
  const tipCopy = showCalendarTip
    ? {
        title: "Planning assistant",
        body: "Find gaps, approval risks, and useful content ideas for this month.",
        modalTitle: "Calendar planning checklist",
        modalBody:
          "Review content gaps, approval deadlines, and channel balance before locking the weekly plan.",
      }
    : isRequestDetail
      ? {
          title: "Designer handoff checklist",
          body: "Attach the final brief, references, and deadlines before sending to design.",
          modalTitle: "Designer handoff checklist",
          modalBody:
            "Confirm the final brief, references, deadlines, and required assets so the design team can start without follow-up.",
        }
      : {
          title: "Faster approval checklist",
          body: "Add clear details to get faster approvals.",
          modalTitle: "Faster approval checklist",
          modalBody:
            "Add these before submitting so approvers and designers can move without follow-up.",
        };
  const [tipOpen, setTipOpen] = useState(false);

  useEffect(() => {
    if (!tipOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setTipOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tipOpen]);

  function handleTipClick() {
    if (showCalendarTip) {
      window.dispatchEvent(new CustomEvent("calendar-optimizer:open"));
      return;
    }
    setTipOpen(true);
  }

  return (
    <>
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 border-r border-white/80 bg-white/82 shadow-[8px_0_40px_rgba(15,23,42,0.035)] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-900 md:block">
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
                    ? "bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-lg shadow-violet-200/70 ring-1 ring-violet-400/30 dark:bg-violet-500 dark:shadow-violet-950/30"
                    : "text-slate-700 hover:bg-white hover:text-slate-950 hover:shadow-sm hover:ring-1 hover:ring-slate-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
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

        {(showRequestTip || showCalendarTip) && (
          <div className="mx-3 mt-4 overflow-hidden rounded-2xl border border-violet-100/90 bg-white/90 p-3 shadow-[0_18px_50px_rgba(124,58,237,0.12)] ring-1 ring-white/70">
            <div className="relative mb-2 flex h-16 items-center justify-center overflow-hidden rounded-2xl bg-violet-50">
              <span className="absolute left-8 top-5 h-1.5 w-1.5 rounded-full bg-white shadow-sm" />
              <span className="absolute right-9 top-5 h-1.5 w-1.5 rounded-full bg-violet-300" />
              <span className="absolute bottom-8 right-7 h-2 w-2 rounded-full bg-violet-400/70" />
              <span className="relative -rotate-12">
                <TipPlaneIcon />
              </span>
            </div>
            <p className="text-sm font-semibold text-violet-700">{tipCopy.title}</p>
            <p className="mt-1.5 text-xs leading-4 text-zinc-600">
              {tipCopy.body}
            </p>
            <button
              type="button"
              onClick={handleTipClick}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-violet-600 shadow-sm ring-1 ring-violet-100 transition hover:bg-violet-50 focus:outline-none focus:ring-4 focus:ring-violet-100"
            >
              {showCalendarTip ? "Try it now" : "Learn more"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

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
    {tipOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-tip-title"
        onMouseDown={() => setTipOpen(false)}
      >
        <div
          className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-5 shadow-[0_28px_90px_rgba(15,23,42,0.28)] ring-1 ring-slate-200"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p id="request-tip-title" className="text-base font-semibold text-slate-950">
                {tipCopy.modalTitle}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {tipCopy.modalBody}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close tip"
              onClick={() => setTipOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-violet-100"
            >
              ×
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Goal", "What should this post or asset achieve?"],
              ["Deadline", "When is it needed, and is there an event date?"],
              ["Copy", "Names, spellings, offers, links, and required wording."],
              ["Assets", "Photos, logos, brand files, or examples to follow."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-slate-950">{title}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTipOpen(false)}
            className="mt-4 flex h-10 w-full items-center justify-center rounded-xl bg-violet-600 text-sm font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700 focus:outline-none focus:ring-4 focus:ring-violet-100"
          >
            Got it
          </button>
        </div>
      </div>
    )}
    </>
  );
}
