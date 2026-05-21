"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createCalendarItem,
  type CalendarItemCreateState,
} from "../actions";

type School = { id: string; name: string };

const initialState: CalendarItemCreateState = {};

export function NewCalendarItemForm({
  schools,
  defaultSchoolId,
  defaultDate,
}: {
  schools: School[];
  defaultSchoolId: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createCalendarItem,
    initialState,
  );

  useEffect(() => {
    if (state.itemId) {
      router.push(`/calendar/${state.itemId}`);
    }
  }, [state.itemId, router]);

  return (
    <form action={formAction} className="space-y-4">
      {schools.length > 1 ? (
        <div>
          <label
            htmlFor="school_id"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            School
          </label>
          <select
            id="school_id"
            name="school_id"
            required
            defaultValue={defaultSchoolId}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="school_id" value={defaultSchoolId} />
      )}

      <div>
        <label
          htmlFor="planned_date"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Date
        </label>
        <input
          id="planned_date"
          name="planned_date"
          type="date"
          required
          defaultValue={defaultDate}
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          What's this slot?
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          autoFocus
          placeholder="e.g. Founder's Day announcement"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Notes <span className="text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="Theme, mood, hashtags…"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      {state.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {pending ? "Saving…" : "Save draft"}
      </button>
    </form>
  );
}
