"use client";

import { useRef, useState } from "react";

export function FeedFeedback({
  requestId,
  addFeedbackAction,
}: {
  requestId: string;
  addFeedbackAction: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Leave feedback →
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await addFeedbackAction(formData);
        formRef.current?.reset();
        setOpen(false);
      }}
      className="flex gap-2"
    >
      <input type="hidden" name="request_id" value={requestId} />
      <input
        name="body"
        type="text"
        placeholder="Great work! or suggest changes..."
        required
        autoFocus
        className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <button
        type="submit"
        className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Send
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-zinc-500 hover:text-zinc-700"
      >
        Cancel
      </button>
    </form>
  );
}
