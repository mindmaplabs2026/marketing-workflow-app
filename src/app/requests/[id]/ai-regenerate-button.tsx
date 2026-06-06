"use client";

import { useState } from "react";
import { regenerateAi } from "../actions";

export function AiRegenerateButton({
  requestId,
  label,
  currentTitle,
  currentDescription,
}: {
  requestId: string;
  label?: string;
  currentTitle?: string;
  currentDescription?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posterType, setPosterType] = useState<"single" | "carousel">("single");
  const [showOptions, setShowOptions] = useState(false);
  const [title, setTitle] = useState(currentTitle ?? "");
  const [description, setDescription] = useState(currentDescription ?? "");

  async function handleRegenerate() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await regenerateAi(requestId, posterType, title.trim(), description.trim() || null);
    if (result.error) {
      setError(result.error);
      setBusy(false);
    } else {
      // Full page reload to ensure progress tracker shows up
      window.location.reload();
    }
  }

  if (!showOptions) {
    return (
      <button
        type="button"
        onClick={() => setShowOptions(true)}
        className="rounded-md border border-violet-300 bg-white px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950"
      >
        {label ?? "Regenerate with AI"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-900/10">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Regenerate with AI
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Update the title or description to guide the AI, then regenerate. Previous results will be kept.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="regen_title"
            className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Title
          </label>
          <input
            id="regen_title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div>
          <label
            htmlFor="regen_description"
            className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Description / additional instructions
          </label>
          <textarea
            id="regen_description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Add keywords, style preferences, or specific instructions for the AI..."
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex items-end gap-3">
          <div>
            <label
              htmlFor="regen_poster_type"
              className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Poster type
            </label>
            <select
              id="regen_poster_type"
              value={posterType}
              onChange={(e) =>
                setPosterType(e.target.value as "single" | "carousel")
              }
              disabled={busy}
              className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="single">Single poster</option>
              <option value="carousel">Carousel (3-5 pages)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
          >
            {busy ? "Starting..." : "Regenerate"}
          </button>

          <button
            type="button"
            onClick={() => setShowOptions(false)}
            disabled={busy}
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
