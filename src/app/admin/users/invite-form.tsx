"use client";

import { useActionState, useRef, useState } from "react";
import { inviteUser, type InviteState } from "./actions";
import type { UserRole } from "@/lib/supabase/types";

const initialState: InviteState = {};

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "designer", label: "Designer" },
  { value: "super_admin", label: "Super admin" },
  { value: "school_admin", label: "School admin" },
  { value: "teacher", label: "Teacher" },
  { value: "decision_maker", label: "Decision maker" },
];

const INTERNAL_ROLES: UserRole[] = ["super_admin", "designer"];

type SchoolLite = { id: string; name: string };

export function InviteForm({ schools }: { schools: SchoolLite[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  // Default role is "designer" (first option, defaultChecked), which is
  // internal -> no school picker needed.
  const [needsSchool, setNeedsSchool] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (prev: InviteState, fd: FormData): Promise<InviteState> => {
      const result = await inviteUser(prev, fd);
      if (result.success) {
        formRef.current?.reset();
        setNeedsSchool(false);
      }
      return result;
    },
    initialState,
  );

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Invite a teammate
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Sends a one-time link. Designers and super admins set a password;
          school users sign in straight from the link and use magic links
          after that.
        </p>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="grid gap-3 sm:grid-cols-2"
      >
        <div>
          <label
            htmlFor="full_name"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Role
          </legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {ROLE_OPTIONS.map((opt, idx) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="radio"
                  name="role"
                  value={opt.value}
                  defaultChecked={idx === 0}
                  onChange={() =>
                    setNeedsSchool(!INTERNAL_ROLES.includes(opt.value))
                  }
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {needsSchool && (
          <div className="sm:col-span-2">
            <label
              htmlFor="school_id"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              School
            </label>
            {schools.length === 0 ? (
              <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                No schools yet. Add a school first under Admin → Schools.
              </p>
            ) : (
              <select
                id="school_id"
                name="school_id"
                required
                defaultValue=""
                className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              >
                <option value="" disabled>
                  Pick a school…
                </option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {state.error && (
          <p className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
            {state.error}
          </p>
        )}

        {state.success && state.email && (
          <p className="sm:col-span-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">
            Invite sent to {state.email}.
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending || (needsSchool && schools.length === 0)}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {pending ? "Sending…" : "Send invite"}
          </button>
        </div>
      </form>
    </section>
  );
}
