"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  triggerAiGeneration,
  triggerLocalAiGeneration,
  triggerLocalAiGenerationV2,
  triggerLocalReelGeneration,
} from "../actions";

const REEL_LENGTH_OPTIONS = [
  { value: 60, label: "Short (up to 1 min)" },
  { value: 120, label: "Medium (up to 2 min)" },
  { value: 180, label: "Long (up to 3 min)" },
  { value: 300, label: "Full (use all content, max 5 min)" },
];

export function AiGenerateButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState<null | "cloud" | "local" | "local-v2" | "reel">(null);
  const [error, setError] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<"single" | "carousel" | "reel">("single");
  const [reelMaxDuration, setReelMaxDuration] = useState(120);

  async function run(engine: "cloud" | "local" | "local-v2" | "reel") {
    setBusy(engine);
    setError(null);

    let result: { error?: string };
    if (engine === "reel") {
      result = await triggerLocalReelGeneration(requestId, reelMaxDuration);
    } else if (engine === "local-v2") {
      result = await triggerLocalAiGenerationV2(requestId, outputType as "single" | "carousel");
    } else if (engine === "local") {
      result = await triggerLocalAiGeneration(requestId, outputType as "single" | "carousel");
    } else {
      result = await triggerAiGeneration(requestId, outputType as "single" | "carousel");
    }

    if (result.error) {
      setError(result.error);
      toast.error(result.error);
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
        AI will generate content based on the request details and uploaded
        media. Takes about 5-10 minutes.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {/* Output type selector */}
        <div>
          <label
            htmlFor="ai_output_type"
            className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
          >
            Output type
          </label>
          <select
            id="ai_output_type"
            value={outputType}
            onChange={(e) =>
              setOutputType(e.target.value as "single" | "carousel" | "reel")
            }
            disabled={busy !== null}
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="single">Single poster</option>
            <option value="carousel">Carousel (3-5 pages)</option>
            <option value="reel">Reel (video)</option>
          </select>
        </div>

        {/* Reel length selector — only visible for reels */}
        {outputType === "reel" && (
          <div>
            <label
              htmlFor="ai_reel_length"
              className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Reel length
            </label>
            <select
              id="ai_reel_length"
              value={reelMaxDuration}
              onChange={(e) => setReelMaxDuration(Number(e.target.value))}
              disabled={busy !== null}
              className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              {REEL_LENGTH_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Poster buttons (cloud + local) — hidden for reels */}
        {outputType !== "reel" && (
          <>
            <button
              type="button"
              onClick={() => run("cloud")}
              disabled={busy !== null}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
            >
              {busy === "cloud" ? "Starting..." : "Generate with AI"}
            </button>

            <button
              type="button"
              onClick={() => run("local")}
              disabled={busy !== null}
              className="rounded-md border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50 disabled:opacity-50 dark:border-violet-500 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950"
            >
              {busy === "local" ? "Starting..." : "Generate with Local AI"}
            </button>

            <button
              type="button"
              onClick={() => run("local-v2")}
              disabled={busy !== null}
              className="rounded-md border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              {busy === "local-v2" ? "Starting..." : "Generate with Local AI v2"}
            </button>
          </>
        )}

        {/* Reel button — only for reels (always local) */}
        {outputType === "reel" && (
          <button
            type="button"
            onClick={() => run("reel")}
            disabled={busy !== null}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
          >
            {busy === "reel" ? "Starting..." : "Generate Reel"}
          </button>
        )}
      </div>

      {outputType === "reel" && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Actual duration is calculated from your uploaded content. This setting caps the maximum length.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
