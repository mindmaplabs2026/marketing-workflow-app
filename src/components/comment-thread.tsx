"use client";

import { useRef } from "react";

type Comment = {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

const ROLE_COLORS: Record<string, string> = {
  teacher: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  school_admin:
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  designer:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  super_admin:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

export function CommentThread({
  comments,
  requestId,
  addCommentAction,
}: {
  comments: Comment[];
  requestId: string;
  addCommentAction: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Comments ({comments.length})
      </h2>

      {comments.length === 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          No comments yet. Start the conversation.
        </p>
      )}

      {comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                  {c.authorName}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${ROLE_COLORS[c.authorRole] ?? "bg-zinc-100 text-zinc-600"}`}
                >
                  {c.authorRole.replace("_", " ")}
                </span>
                <span className="text-[10px] text-zinc-400">
                  {formatTime(c.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        action={async (formData) => {
          const body = String(formData.get("body") ?? "").trim();
          if (!body) return;
          await addCommentAction(formData);
          formRef.current?.reset();
        }}
        className="flex gap-2"
      >
        <input type="hidden" name="request_id" value={requestId} />
        <input
          name="body"
          type="text"
          placeholder="Write a comment..."
          required
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="shrink-0 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
        >
          Send
        </button>
      </form>
    </section>
  );
}
