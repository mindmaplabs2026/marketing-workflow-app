"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@/lib/supabase/types";
import { updateUserRole } from "./actions";

const ROLES: { value: UserRole; label: string }[] = [
  { value: "super_admin", label: "Super admin" },
  { value: "designer", label: "Designer" },
  { value: "school_admin", label: "School admin" },
  { value: "teacher", label: "Teacher" },
  { value: "decision_maker", label: "Decision maker" },
];

export function RoleSelect({
  userId,
  currentRole,
  disabled,
}: {
  userId: string;
  currentRole: UserRole;
  disabled?: boolean;
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
      try {
        const fd = new FormData();
        fd.append("user_id", userId);
        fd.append("role", newRole);
        await updateUserRole(fd);
        // Force the server component to re-fetch profiles so neighbouring
        // rows + counts reflect the change too. revalidatePath inside the
        // action marks the route stale; router.refresh() is what actually
        // re-renders the page.
        router.refresh();
      } catch (err) {
        setRole(previous);
        setError(err instanceof Error ? err.message : "Couldn't update role.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <select
        value={role}
        disabled={disabled || pending}
        onChange={handleChange}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
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
