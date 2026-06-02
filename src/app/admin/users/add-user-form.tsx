"use client";

import { useActionState, useRef, useState } from "react";
import { createUser, type CreateUserState } from "./actions";
import type { UserRole } from "@/lib/supabase/types";

const initialState: CreateUserState = {};

const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const SCHOOL_ROLES: UserRole[] = ["school_admin", "teacher", "decision_maker"];

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const PASSWORD_SYMBOLS = "!@#$%^&*";

function generatePassword(): string {
  if (typeof window === "undefined" || !window.crypto) return "";
  const len = 12;
  const buf = new Uint32Array(len);
  window.crypto.getRandomValues(buf);
  let pwd = "";
  for (let i = 0; i < len - 1; i++) {
    pwd += PASSWORD_ALPHABET[buf[i] % PASSWORD_ALPHABET.length];
  }
  pwd += PASSWORD_SYMBOLS[buf[len - 1] % PASSWORD_SYMBOLS.length];
  return pwd;
}

type SchoolLite = { id: string; name: string };

export function AddUserForm({
  schools,
  availableRoles,
}: {
  schools: SchoolLite[];
  availableRoles: UserRole[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [needsSchool, setNeedsSchool] = useState(
    SCHOOL_ROLES.includes(availableRoles[0]),
  );

  const [state, formAction, pending] = useActionState(
    async (prev: CreateUserState, fd: FormData): Promise<CreateUserState> => {
      const result = await createUser(prev, fd);
      if (result.success) {
        formRef.current?.reset();
        setNeedsSchool(false);
      }
      return result;
    },
    initialState,
  );

  function handleGenerate() {
    if (!passwordRef.current) return;
    passwordRef.current.value = generatePassword();
    passwordRef.current.type = "text";
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          Add a teammate
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Creates the account with the email + password you set. Both are
          emailed to the user; they&rsquo;re forced to change the password the
          first time they sign in.
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

        <div className="sm:col-span-2">
          <label
            htmlFor="password"
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Initial password
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="password"
              name="password"
              type="password"
              ref={passwordRef}
              autoComplete="new-password"
              required
              minLength={8}
              className="block w-full flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="button"
              onClick={handleGenerate}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Generate
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Minimum 8 characters. The user changes it on first login.
          </p>
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Role
          </legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {availableRoles.map((value, idx) => (
              <label
                key={value}
                className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="radio"
                  name="role"
                  value={value}
                  defaultChecked={idx === 0}
                  onChange={() => setNeedsSchool(SCHOOL_ROLES.includes(value))}
                />
                {ROLE_LABEL[value]}
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
            User created. Login details sent to {state.email}.
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={pending || (needsSchool && schools.length === 0)}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
          >
            {pending ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </section>
  );
}
