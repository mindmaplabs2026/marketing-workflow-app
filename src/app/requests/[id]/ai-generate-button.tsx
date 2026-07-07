"use client";

import { useState } from "react";
import { Clapperboard, Cpu, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import {
  triggerAiGeneration,
  triggerLocalAiGeneration,
  triggerLocalAiGenerationV2,
  triggerLocalAiGenerationV3,
  triggerLocalReelGeneration,
} from "../actions";

const REEL_LENGTH_OPTIONS = [
  { value: 60, label: "Short (up to 1 min)" },
  { value: 120, label: "Medium (up to 2 min)" },
  { value: 180, label: "Long (up to 3 min)" },
  { value: 300, label: "Full (use all content, max 5 min)" },
];

function AiActionButton({
  children,
  disabled,
  icon,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon: React.ReactNode;
  tone: "primary" | "violet" | "emerald" | "sky";
  onClick: () => void;
}) {
  const toneClass = {
    primary:
      "border-violet-600 bg-violet-600 text-white shadow-sm hover:bg-violet-700",
    violet:
      "border-violet-500 bg-white text-violet-700 shadow-sm hover:bg-violet-50 dark:bg-zinc-900 dark:text-violet-300 dark:hover:bg-violet-950",
    emerald:
      "border-emerald-600 bg-white text-emerald-700 shadow-sm hover:bg-emerald-50 dark:bg-zinc-900 dark:text-emerald-300 dark:hover:bg-emerald-950",
    sky:
      "border-sky-600 bg-white text-sky-700 shadow-sm hover:bg-sky-50 dark:bg-zinc-900 dark:text-sky-300 dark:hover:bg-sky-950",
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center text-[10px] font-semibold leading-tight transition disabled:opacity-50 sm:gap-2 sm:px-3 sm:text-xs xl:text-sm ${toneClass}`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 text-balance">{children}</span>
    </button>
  );
}

export function AiGenerateButton({ requestId }: { requestId: string }) {
  const [busy, setBusy] = useState<null | "cloud" | "local" | "local-v2" | "local-v3" | "reel">(null);
  const [error, setError] = useState<string | null>(null);
  const [outputType, setOutputType] = useState<"single" | "carousel" | "reel">("single");
  const [reelMaxDuration, setReelMaxDuration] = useState(120);

  async function run(engine: "cloud" | "local" | "local-v2" | "local-v3" | "reel") {
    setBusy(engine);
    setError(null);

    let result: { error?: string };
    if (engine === "reel") {
      result = await triggerLocalReelGeneration(requestId, reelMaxDuration);
    } else if (engine === "local-v3") {
      result = await triggerLocalAiGenerationV3(requestId, outputType as "single" | "carousel");
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
    <div className="space-y-2">
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-zinc-50">
          AI generation
        </h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          AI will generate content based on the request details and uploaded
          media. Takes about 5-10 minutes.
        </p>
      </div>

      <div className="grid grid-cols-3 items-end gap-2 lg:grid-cols-5">
        {/* Output type selector */}
        <div className="col-span-3 lg:col-span-1">
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
            className="mt-1 block h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="single">Single poster</option>
            <option value="carousel">Carousel (3-5 pages)</option>
            <option value="reel">Reel (video)</option>
          </select>
        </div>

        {/* Reel length selector — only visible for reels */}
        {outputType === "reel" && (
          <div className="col-span-3 lg:col-span-1">
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
              className="mt-1 block h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
            <AiActionButton
              onClick={() => run("cloud")}
              disabled={busy !== null}
              tone="primary"
              icon={<WandSparkles className="h-4 w-4" aria-hidden="true" />}
            >
              {busy === "cloud" ? "Starting..." : "Generate with AI"}
            </AiActionButton>

            <AiActionButton
              onClick={() => run("local")}
              disabled={busy !== null}
              tone="violet"
              icon={<Cpu className="h-4 w-4" aria-hidden="true" />}
            >
              {busy === "local" ? "Starting..." : "Generate with Local AI"}
            </AiActionButton>

            <AiActionButton
              onClick={() => run("local-v2")}
              disabled={busy !== null}
              tone="emerald"
              icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
            >
              {busy === "local-v2" ? "Starting..." : "Generate with Local AI v2"}
            </AiActionButton>

            <AiActionButton
              onClick={() => run("local-v3")}
              disabled={busy !== null}
              tone="sky"
              icon={<Cpu className="h-4 w-4" aria-hidden="true" />}
            >
              {busy === "local-v3" ? "Starting..." : "Generate with Local AI v3"}
            </AiActionButton>
          </>
        )}

        {/* Reel button — only for reels (always local) */}
        {outputType === "reel" && (
          <AiActionButton
            onClick={() => run("reel")}
            disabled={busy !== null}
            tone="primary"
            icon={<Clapperboard className="h-4 w-4" aria-hidden="true" />}
          >
            {busy === "reel" ? "Starting..." : "Generate Reel"}
          </AiActionButton>
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
