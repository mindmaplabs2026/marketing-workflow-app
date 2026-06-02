"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/supabase/types";

const SUPER_NAV = [
  { href: "/admin/pipeline", label: "Pipeline" },
  { href: "/admin/schools", label: "Schools" },
  { href: "/admin/users", label: "Users" },
];

const SCHOOL_NAV = [{ href: "/admin/users", label: "Users" }];

export function AdminTabs({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const nav = role === "super_admin" ? SUPER_NAV : SCHOOL_NAV;

  return (
    <nav className="-mb-px flex flex-wrap gap-1 text-sm">
      {nav.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-t-md border-b-2 border-violet-600 px-3 py-2 font-medium text-violet-700 dark:border-violet-400 dark:text-violet-300"
                : "rounded-t-md border-b-2 border-transparent px-3 py-2 font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-50"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
