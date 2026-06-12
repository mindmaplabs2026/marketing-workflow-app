"use client";

import { useState } from "react";
import { triggerAiGeneration, triggerLocalAiGeneration } from "../actions";

export function AiGenerateButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState<null | "cloud" | "local">(null);
  const [error, setError] = useState<string | null>(null);
  const [posterType, setPosterType] = useState<"single" | "carousel">("single");

  async function run(engine: "cloud" | "local") {
    setBusy(engine);
    setError(null);
    const result =
      engine === "local"
        ? await triggerLocalAiGeneration(requestId, posterType)
        : await triggerAiGeneration(requestId, posterType);
    if (result.error) {
      setError(result.error);
      setBusy(null);
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-900/10">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Assign to AI
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        AI will generate a poster based on the request details and uploaded
        photos. Takes about 5-10 minutes.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="ai_poster_type"
            className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Poster type
          </label>
          <select
            id="ai_poster_type"
            value={posterType}
            onChange={(e) =>
              setPosterType(e.target.value as "single" | "carousel")
            }
            disabled={busy !== null}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="single">Single poster</option>
            <option value="carousel">Carousel (3-5 pages)</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => run("cloud")}
          disabled={busy !== null}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
        >
          {busy === "cloud" ? "Starting…" : "Generate with AI"}
        </button>

        <button
          type="button"
          onClick={() => run("local")}
          disabled={busy !== null}
          className="rounded-md border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50 disabled:opacity-50 dark:border-violet-500 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950"
        >
          {busy === "local" ? "Starting…" : "Generate with Local AI"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
