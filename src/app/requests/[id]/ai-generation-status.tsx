"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AiJobStatus } from "@/lib/supabase/types";

const POSTER_STEPS: { key: AiJobStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "understanding", label: "Analyzing images" },
  { key: "creative", label: "Creative direction" },
  { key: "generating", label: "Generating posters" },
  { key: "completed", label: "Complete" },
];

const REEL_STEPS: { key: AiJobStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "understanding", label: "Analyzing media" },
  { key: "creative", label: "Writing reel script" },
  { key: "music", label: "Finding music" },
  { key: "generating", label: "Rendering video" },
  { key: "completed", label: "Complete" },
];

function buildStepOrder(steps: { key: AiJobStatus }[]): Record<AiJobStatus, number> {
  const order: Partial<Record<AiJobStatus, number>> = { failed: -1 };
  steps.forEach((s, i) => { order[s.key] = i; });
  return order as Record<AiJobStatus, number>;
}

const STATUS_MESSAGES: Record<string, Record<AiJobStatus, string>> = {
  poster: {
    queued: "Waiting in queue\u2026",
    understanding: "Analyzing your images and theme\u2026",
    creative: "Researching trends and creating brief\u2026",
    music: "",
    generating: "Generating poster\u2026",
    completed: "",
    failed: "",
  },
  reel: {
    queued: "Waiting in queue\u2026",
    understanding: "Analyzing your photos and videos\u2026",
    creative: "Designing the reel\u2026",
    music: "Finding the right background music\u2026",
    generating: "Rendering video (this takes a few minutes)\u2026",
    completed: "",
    failed: "",
  },
};

export function AiGenerationStatus({
  jobId,
  initialStatus,
  posterType,
  onComplete,
}: {
  jobId: string;
  initialStatus: AiJobStatus;
  posterType?: string | null;
  onComplete?: () => void;
}) {
  const [status, setStatus] = useState<AiJobStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);

  const isReel = posterType === "reel";
  const STEPS = isReel ? REEL_STEPS : POSTER_STEPS;
  const STEP_ORDER = buildStepOrder(STEPS);
  const messages = isReel ? STATUS_MESSAGES.reel : STATUS_MESSAGES.poster;

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`ai-job-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ai_generation_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const newStatus = payload.new.status as AiJobStatus;
          setStatus(newStatus);
          if (newStatus === "failed") {
            setError(
              (payload.new.error_message as string) ?? "Generation failed.",
            );
          }
          if (newStatus === "completed") {
            onComplete?.();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, onComplete]);

  if (status === "failed") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/20">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          AI generation failed
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    );
  }

  const currentOrder = STEP_ORDER[status] ?? 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {isReel ? "AI is generating your reel" : "AI is generating your posters"}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        You&apos;ll get a notification when it&apos;s ready.
      </p>

      <div className="mt-4 flex items-start">
        {STEPS.map((step, i) => {
          const stepOrder = STEP_ORDER[step.key];
          const isActive = stepOrder === currentOrder;
          const isDone = stepOrder < currentOrder;

          return (
            <div key={step.key} className="flex flex-1 flex-col items-center" style={{ position: "relative" }}>
              <div className="flex w-full items-center">
                {i > 0 && (
                  <div
                    className={`h-0.5 flex-1 ${isDone ? "bg-violet-600" : "bg-zinc-200 dark:bg-zinc-700"}`}
                  />
                )}
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                    isDone
                      ? "bg-violet-600 text-white"
                      : isActive
                        ? "bg-violet-100 text-violet-700 ring-2 ring-violet-600 dark:bg-violet-900/30 dark:text-violet-300"
                        : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                  }`}
                >
                  {isDone ? "\u2713" : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 ${isDone && stepOrder + 1 <= currentOrder ? "bg-violet-600" : "bg-zinc-200 dark:bg-zinc-700"}`}
                  />
                )}
              </div>
              <p
                className={`mt-1 text-center text-[10px] leading-tight ${
                  isActive
                    ? "font-medium text-violet-700 dark:text-violet-300"
                    : isDone
                      ? "text-zinc-600 dark:text-zinc-400"
                      : "text-zinc-400"
                }`}
              >
                {step.label}
              </p>
            </div>
          );
        })}
      </div>

      {status !== "completed" && messages[status] && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600" />
          <p className="text-xs text-zinc-500">{messages[status]}</p>
        </div>
      )}
    </div>
  );
}
