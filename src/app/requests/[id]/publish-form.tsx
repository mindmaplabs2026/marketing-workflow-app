"use client";

import { useState } from "react";
import { toast } from "sonner";
import { publishRequest } from "../actions";
import type { SocialPlatform } from "@/lib/supabase/types";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  youtube: "YouTube",
  other: "Other",
};

const PLATFORMS = Object.keys(PLATFORM_LABEL) as SocialPlatform[];

type LinkRow = { platform: SocialPlatform; url: string };

export function PublishForm({ requestId }: { requestId: string }) {
  const [rows, setRows] = useState<LinkRow[]>([
    { platform: "facebook", url: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<LinkRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, { platform: "instagram", url: "" }]);
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const filled = rows.filter((r) => r.url.trim());
    if (filled.length === 0) {
      setError("Add at least one URL.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("id", requestId);
      for (const r of filled) {
        fd.append("platform", r.platform);
        fd.append("url", r.url.trim());
      }
      await publishRequest(fd);
      toast.success("Marked as published — links saved.");
      setBusy(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      setError(msg);
      toast.error(msg);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Paste the live links
      </p>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-stretch gap-2">
            <select
              value={r.platform}
              onChange={(e) =>
                update(i, { platform: e.target.value as SocialPlatform })
              }
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 sm:w-auto"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
            <input
              type="url"
              required={i === 0}
              placeholder="https://…"
              value={r.url}
              onChange={(e) => update(i, { url: e.target.value })}
              className="w-full min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 sm:w-auto"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="rounded-md px-2 py-2 text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={addRow}
        className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        + Add another platform
      </button>
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Publishing…" : "Mark published"}
        </button>
      </div>
    </form>
  );
}
