"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/lib/supabase/types";
import { updateUserRole } from "./actions";

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const ALL_ROLES: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

export function RoleSelect({
  userId,
  currentRole,
  disabled,
  availableRoles,
}: {
  userId: string;
  currentRole: UserRole;
  disabled?: boolean;
  availableRoles?: UserRole[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>(currentRole);
  const [error, setError] = useState<string | null>(null);

  // When the server pushes a fresh value (after revalidate / nav), make
  // sure the displayed selection follows it. Without this the dropdown is
  // uncontrolled-ish and can drift from the DB if a teammate edits the
  // same user in another tab.
  useEffect(() => {
    setRole(currentRole);
  }, [currentRole]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.currentTarget.value as UserRole;
    const previous = role;
    setRole(newRole);
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("user_id", userId);
      fd.append("role", newRole);
      const result = await updateUserRole(fd);
      if (result?.error) {
        setRole(previous);
        setError(result.error);
        return;
      }
      // Force the server component to re-fetch profiles so neighbouring
      // rows + counts reflect the change too. revalidatePath inside the
      // action marks the route stale; router.refresh() is what actually
      // re-renders the page.
      router.refresh();
    });
  }

  const options = availableRoles ?? ALL_ROLES;

  return (
    <div className="flex flex-col items-start gap-1">
      <select
        value={role}
        disabled={disabled || pending}
        onChange={handleChange}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800"
      >
        {options.map((value) => (
          <option key={value} value={value}>
            {ROLE_LABEL[value]}
          </option>
        ))}
      </select>
      {error && (
        <p className="text-[11px] leading-tight text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}
