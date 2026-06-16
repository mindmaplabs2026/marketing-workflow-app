"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { addMember, type MemberActionState } from "./actions";

const initialState: MemberActionState = {};

type Candidate = { id: string; label: string };

export function AddMemberForm({
  schoolId,
  candidates,
}: {
  schoolId: string;
  candidates: Candidate[];
}) {
  const boundAction = addMember.bind(null, schoolId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      toast.success("Member added");
    }
  }, [state.success]);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state.error]);

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        No other users available to add. Invite people to sign up first.
      </p>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex items-start gap-2">
      <div className="flex-1">
        <label htmlFor="user_id" className="sr-only">
          User
        </label>
        <select
          id="user_id"
          name="user_id"
          required
          defaultValue=""
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          <option value="" disabled>
            Pick a user to add as member…
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {state.error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
      >
        {pending ? "Adding…" : "Add member"}
      </button>
    </form>
  );
}
