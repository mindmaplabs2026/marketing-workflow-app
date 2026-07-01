"use client";

import { useState } from "react";
import { toast } from "sonner";
import { regenerateAi } from "../actions";

const REEL_LENGTH_OPTIONS = [
  { value: 60, label: "Short (up to 1 min)" },
  { value: 120, label: "Medium (up to 2 min)" },
  { value: 180, label: "Long (up to 3 min)" },
  { value: 300, label: "Full (use all content, max 5 min)" },
];

export function AiRegenerateButton({
  requestId,
  currentTitle,
  currentDescription,
}: {
  requestId: string;
  currentTitle?: string;
  currentDescription?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<"single" | "carousel" | "reel">("single");
  const [reelMaxDuration, setReelMaxDuration] = useState(120);
  const [engine, setEngine] = useState<"cloud" | "local" | "local-v2" | "local-v3">("cloud");
  const [showOptions, setShowOptions] = useState(false);
  const [title, setTitle] = useState(currentTitle ?? "");
  const [description, setDescription] = useState(currentDescription ?? "");

  const engineLabel = outputType === "reel"
    ? "Local AI (Reel)"
    : engine === "local-v3"
    ? "Local AI v3"
    : engine === "local-v2"
    ? "Local AI v2"
    : engine === "local"
    ? "Local AI"
    : "AI";

  function open(e: "cloud" | "local" | "local-v2" | "local-v3" | "reel") {
    if (e === "reel") {
      setEngine("local");
      setOutputType("reel");
    } else {
      setEngine(e);
      if (outputType === "reel") setOutputType("single");
    }
    setError(null);
    setShowOptions(true);
  }

  async function handleRegenerate() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await regenerateAi(
      requestId,
      outputType,
      title.trim(),
      description.trim() || null,
      outputType === "reel" ? "local" : engine === "local-v2" || engine === "local-v3" ? "local" : engine,
      outputType === "reel" ? reelMaxDuration : undefined,
      engine === "local-v3" ? "v3" : engine === "local-v2" ? "v2" : "v1",
    );
    if (result.error) {
      setError(result.error);
      toast.error(result.error);
      setBusy(false);
    } else {
      window.location.reload();
    }
  }

  if (!showOptions) {
    return (
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => open("cloud")}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600"
        >
          Regenerate with AI
        </button>
        <button
          type="button"
          onClick={() => open("local")}
          className="rounded-md border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50 dark:border-violet-500 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950"
        >
          Regenerate with Local AI
        </button>
        <button
          type="button"
          onClick={() => open("local-v2")}
          className="rounded-md border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm hover:bg-emerald-50 dark:border-emerald-500 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
        >
          Regenerate with Local AI v2
        </button>
        <button
          type="button"
          onClick={() => open("local-v3")}
          className="rounded-md border border-sky-600 bg-white px-4 py-2 text-sm font-medium text-sky-700 shadow-sm hover:bg-sky-50 dark:border-sky-500 dark:bg-zinc-900 dark:text-sky-300 dark:hover:bg-sky-950"
        >
          Regenerate with Local AI v3
        </button>
        <button
          type="button"
          onClick={() => open("reel")}
          className="rounded-md border border-violet-600 bg-white px-4 py-2 text-sm font-medium text-violet-700 shadow-sm hover:bg-violet-50 dark:border-violet-500 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950"
        >
          Generate Reel
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-900/40 dark:bg-violet-900/10">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        Regenerate with {engineLabel}
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        {outputType === "reel"
          ? "Generate an Instagram Reel video from the uploaded media. Previous results will be kept."
          : "Update the title or description to guide the AI, then regenerate. Previous results will be kept."}
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

        <div className="flex flex-wrap items-end gap-3">
          {/* Output type selector */}
          <div>
            <label
              htmlFor="regen_output_type"
              className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
            >
              Output type
            </label>
            <select
              id="regen_output_type"
              value={outputType}
              onChange={(e) =>
                setOutputType(e.target.value as "single" | "carousel" | "reel")
              }
              disabled={busy}
              className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            >
              <option value="single">Single poster</option>
              <option value="carousel">Carousel (3-5 pages)</option>
              <option value="reel">Reel (video)</option>
            </select>
          </div>

          {/* Duration picker — only for reels */}
          {outputType === "reel" && (
            <div>
              <label
                htmlFor="regen_reel_duration"
                className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
              >
                Reel length
              </label>
              <select
                id="regen_reel_duration"
                value={reelMaxDuration}
                onChange={(e) => setReelMaxDuration(Number(e.target.value))}
                disabled={busy}
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

          <button
            type="button"
            onClick={handleRegenerate}
            disabled={busy}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
          >
            {busy ? "Starting..." : outputType === "reel" ? "Generate Reel" : `Regenerate with ${engineLabel}`}
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

        {outputType === "reel" && (
          <p className="text-[10px] text-zinc-400">
            Actual duration is calculated from your uploaded content. This setting caps the maximum length.
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
