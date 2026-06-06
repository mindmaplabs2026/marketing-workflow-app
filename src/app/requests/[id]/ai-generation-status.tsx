"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AiJobStatus } from "@/lib/supabase/types";

const STEPS: { key: AiJobStatus; label: string }[] = [
  { key: "queued", label: "Queued" },
  { key: "understanding", label: "Analyzing images" },
  { key: "creative", label: "Creative direction" },
  { key: "generating", label: "Generating posters" },
  { key: "completed", label: "Complete" },
];

const STEP_ORDER: Record<AiJobStatus, number> = {
  queued: 0,
  understanding: 1,
  creative: 2,
  generating: 3,
  completed: 4,
  failed: -1,
};

export function AiGenerationStatus({
  jobId,
  initialStatus,
  onComplete,
}: {
  jobId: string;
  initialStatus: AiJobStatus;
  onComplete?: () => void;
}) {
  const [status, setStatus] = useState<AiJobStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);

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

  const currentOrder = STEP_ORDER[status];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
        AI is generating your posters
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
                  {isDone ? "✓" : i + 1}
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

      {status !== "completed" && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-600" />
          <p className="text-xs text-zinc-500">
            {status === "queued" && "Waiting in queue…"}
            {status === "understanding" && "Analyzing your images and theme…"}
            {status === "creative" && "Researching trends and creating brief…"}
            {status === "generating" && "Generating poster…"}
          </p>
        </div>
      )}
    </div>
  );
}
