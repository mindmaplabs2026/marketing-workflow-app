"use client";

import { useActionState, useEffect, useRef } from "react";
import { createSchool, type ActionState } from "./actions";

const initialState: ActionState = {};

export function CreateSchoolForm() {
  const [state, formAction, pending] = useActionState(
    createSchool,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex items-start gap-2">
      <div className="flex-1">
        <label htmlFor="name" className="sr-only">
          School name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="Add a school (e.g. Lincoln High)"
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        {state.error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {pending ? "Adding…" : "Add school"}
      </button>
    </form>
  );
}
