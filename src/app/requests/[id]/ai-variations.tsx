"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { acceptAiVariation } from "../actions";
import { toast } from "sonner";

type Variation = {
  id: string;
  variation_index: number;
  creative_brief: {
    direction?: string;
    theme?: string;
    colorPalette?: string[];
    textContent?: { headline?: string };
  };
  storage_paths: string[];
  poster_type: "single" | "carousel" | "reel";
  is_accepted: boolean;
  chat_rounds_used: number;
};

function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function MobileReelPreview({
  src,
}: {
  src: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  }

  function cycleSpeed() {
    const video = videoRef.current;
    if (!video) return;
    const nextRate = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    video.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  }

  function seek(value: string) {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = Number(value);
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  function openFullscreen() {
    void frameRef.current?.requestFullscreen?.();
  }

  return (
    <div ref={frameRef} className="relative h-full w-full lg:hidden">
      <video
        ref={videoRef}
        playsInline
        muted={muted}
        preload="metadata"
        className="h-full w-full rounded-t-lg object-cover"
        src={src}
        onClick={togglePlayback}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.playbackRate = playbackRate;
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openFullscreen();
        }}
        className="absolute right-11 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur hover:bg-black/70"
        aria-label="View fullscreen"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path d="M7 3H3v4M13 3h4v4M7 17H3v-4M13 17h4v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="absolute inset-x-2 bottom-2 rounded-xl bg-black/60 p-1.5 text-white shadow-sm backdrop-blur">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              togglePlayback();
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950"
            aria-label={playing ? "Pause preview" : "Play preview"}
          >
            {playing ? (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M6 4.5h2.5v11H6v-11Zm5.5 0H14v11h-2.5v-11Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 translate-x-px" aria-hidden="true">
                <path d="M6.5 4.5v11l8-5.5-8-5.5Z" />
              </svg>
            )}
          </button>

          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => seek(event.target.value)}
            className="h-1 min-w-0 flex-1 accent-violet-400"
            aria-label="Video timeline"
          />

          <span className="w-8 shrink-0 text-right text-[9px] font-semibold tabular-nums">
            {formatMediaTime(currentTime)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleMute();
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15"
            aria-label={muted ? "Unmute preview" : "Mute preview"}
          >
            {muted ? (
              <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M4 8.25v3.5h2.5L10 15V5L6.5 8.25H4Z" fill="currentColor" />
                <path d="m13.25 8 3 3m0-3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M4 8.25v3.5h2.5L10 15V5L6.5 8.25H4Z" fill="currentColor" />
                <path d="M12.5 7.25c.75.65 1.1 1.55 1.1 2.75s-.35 2.1-1.1 2.75M14.8 5.5c1.15 1.1 1.8 2.55 1.8 4.5s-.65 3.4-1.8 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              cycleSpeed();
            }}
            className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiVariations({
  requestId,
  variations: initialVariations,
  totalCostUsd,
}: {
  requestId: string;
  variations: Variation[];
  totalCostUsd?: number | null;
}) {
  const router = useRouter();
  const [variations] = useState(initialVariations);
  const [signedUrls, setSignedUrls] = useState<Map<string, string[]>>(
    new Map(),
  );
  const [accepting, setAccepting] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState<Map<string, number>>(
    new Map(),
  );

  // Load signed URLs for variation images
  useEffect(() => {
    async function loadUrls() {
      const supabase = createClient();
      const urlMap = new Map<string, string[]>();

      for (const v of variations) {
        const urls: string[] = [];
        for (const path of v.storage_paths) {
          const { data, error: signErr } = await supabase.storage
            .from("designs")
            .createSignedUrl(path, 3600);
          if (signErr) {
            console.error(`[ai-variations] Signed URL failed for ${path}:`, signErr.message);
          }
          if (data?.signedUrl) urls.push(data.signedUrl);
        }
        if (urls.length === 0 && v.storage_paths.length > 0) {
          console.warn(`[ai-variations] No signed URLs for variation ${v.id} (${v.storage_paths.length} paths)`);
        }
        urlMap.set(v.id, urls);
      }

      setSignedUrls(urlMap);
    }
    loadUrls();
  }, [variations]);

  async function handleAccept(variationId: string) {
    setAccepting(variationId);
    try {
      const fd = new FormData();
      fd.set("variation_id", variationId);
      fd.set("request_id", requestId);
      await acceptAiVariation(fd);
      toast.success("Design accepted");
      router.refresh();
    } catch {
      toast.error("Couldn't accept the design. Please try again.");
      setAccepting(null);
    }
  }

  const accepted = variations.find((v) => v.is_accepted);
  const visibleVariations = showAll ? variations : variations.slice(0, 8);
  const mobileHiddenCount = Math.max(variations.length - 2, 0);
  const desktopHiddenCount = Math.max(variations.length - 8, 0);

  if (accepted) {
    const allAcceptedUrls = signedUrls.get(accepted.id) ?? [];
    // Single posters: chat edits are appended — show only the latest. Carousels: all pages.
    const urls = accepted.poster_type === "single" ? allAcceptedUrls.slice(-1) : allAcceptedUrls;
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/50 dark:bg-emerald-900/20">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          Variation {accepted.variation_index} accepted — awaiting school admin
          approval
        </p>
        {urls.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {urls.map((url, i) => (
              <div key={i} className="relative shrink-0">
                <img
                  src={url}
                  alt={`Accepted poster page ${i + 1}`}
                  className="h-40 w-40 rounded-md border border-emerald-200 object-cover dark:border-emerald-900/50"
                />
                <a
                  href={url}
                  download={`accepted-v${accepted.variation_index}-page-${i + 1}.png`}
                  target="_blank"
                  rel="noreferrer"
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                  title="Download"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                    <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                    <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                  </svg>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            AI generated {variations.length} variation{variations.length !== 1 ? "s" : ""}
          </p>
          {totalCostUsd != null && totalCostUsd > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              AI cost: ${totalCostUsd.toFixed(2)}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500">
          Review each variation. Click &quot;Chat &amp; Edit&quot; to make
          changes, or accept one to send to your school admin.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
        {visibleVariations.map((v, index) => {
          const allUrls = signedUrls.get(v.id) ?? [];
          // Single posters: chat edits are appended (history) — show only the
          // LATEST version. Carousels: show every page.
          const urls = v.poster_type === "single" ? allUrls.slice(-1) : allUrls;
          const brief = v.creative_brief;
          const idx = carouselIndex.get(v.id) ?? 0;

          return (
            <div
              key={v.id}
              className={`min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${
                !showAll && index >= 2 ? "hidden lg:block" : ""
              }`}
            >
              {/* Media preview */}
              <div className={`relative ${v.poster_type === "reel" ? "aspect-[4/5] max-h-[340px]" : "aspect-[5/4] lg:aspect-[5/3]"} bg-zinc-100 dark:bg-zinc-800`}>
                {urls.length > 0 ? (
                  <>
                    {v.poster_type === "reel" ? (
                      <>
                        <MobileReelPreview src={urls[0]} />
                        <video
                          controls
                          playsInline
                          className="hidden h-full w-full rounded-t-lg object-cover lg:block"
                          src={urls[0]}
                        />
                      </>
                    ) : (
                      <img
                        src={urls[idx]}
                        alt={`Variation ${v.variation_index}`}
                        className="h-full w-full object-cover"
                      />
                    )}
                    <a
                      href={urls[v.poster_type === "reel" ? 0 : idx]}
                      download={v.poster_type === "reel"
                        ? `variation-${v.variation_index}-reel.mp4`
                        : `variation-${v.variation_index}-page-${idx + 1}.png`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                      title="Download"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                        <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                        <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                      </svg>
                    </a>
                    {v.poster_type !== "reel" && urls.length > 1 && (
                      <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                        {urls.map((_, i) => (
                          <button
                            key={i}
                            onClick={() =>
                              setCarouselIndex((prev) =>
                                new Map(prev).set(v.id, i),
                              )
                            }
                            className={`h-1.5 w-1.5 rounded-full ${
                              i === idx
                                ? "bg-white"
                                : "bg-white/50"
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-400">
                    Loading…
                  </div>
                )}
              </div>

              {/* Brief info */}
              <div className="space-y-1.5 p-2 lg:p-2.5">
                <p className="line-clamp-2 text-[11px] font-medium leading-tight text-zinc-900 lg:text-xs dark:text-zinc-50">
                  {brief.direction ?? `Variation ${v.variation_index}`}
                </p>
                {brief.textContent?.headline && (
                  <p className="line-clamp-2 text-[10px] text-zinc-500 lg:text-xs">
                    &ldquo;{brief.textContent.headline}&rdquo;
                  </p>
                )}
                {brief.colorPalette && brief.colorPalette.length > 0 && (
                  <div className="flex gap-1">
                    {brief.colorPalette.slice(0, 5).map((hex, i) => (
                      <div
                        key={i}
                        className="h-2.5 w-2.5 rounded-full border border-zinc-200 lg:h-3.5 lg:w-3.5 dark:border-zinc-700"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                  </div>
                )}
                <p className="text-[9px] text-zinc-400 lg:text-[10px]">
                  {v.poster_type === "reel"
                    ? "Video reel"
                    : v.poster_type === "carousel"
                    ? `${v.storage_paths.length} pages`
                    : "Single poster"}
                  {v.chat_rounds_used > 0 &&
                    ` · ${v.chat_rounds_used}/25 edits used`}
                </p>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 gap-1.5 border-t border-zinc-200 p-2 lg:flex lg:gap-2 lg:p-2.5 dark:border-zinc-800">
                <a
                  href={`/requests/${requestId}/chat/${v.id}`}
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-center text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 lg:px-3 lg:text-[11px] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Chat &amp; Edit
                </a>
                <button
                  type="button"
                  disabled={accepting !== null}
                  onClick={() => handleAccept(v.id)}
                  className="flex-1 rounded-md bg-violet-600 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-violet-700 disabled:opacity-50 lg:px-3 lg:text-[11px] dark:bg-violet-500 dark:hover:bg-violet-600"
                >
                  {accepting === v.id ? "Accepting…" : "Accept"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {mobileHiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="inline-flex h-9 items-center rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50 lg:hidden dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300"
        >
          {showAll ? "Show less" : `View ${mobileHiddenCount} more`}
        </button>
      )}
      {desktopHiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="hidden h-9 items-center rounded-lg border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50 lg:inline-flex dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300"
        >
          {showAll ? "Show less" : `View ${desktopHiddenCount} more`}
        </button>
      )}
    </div>
  );
}
