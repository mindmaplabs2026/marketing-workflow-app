"use client";

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
  return (
    <form action={updateUserRole}>
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="role"
        defaultValue={currentRole}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:disabled:bg-zinc-800"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    </form>
  );
}
