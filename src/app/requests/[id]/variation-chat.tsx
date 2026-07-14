"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  imageUrls: string[];
  created_at: string;
};

type SubmitResponse = {
  status: "processing";
  userMessageId: string;
  roundsRemaining: number;
  error?: string;
};

type PollResponse = {
  status: "processing" | "complete";
  message?: string;
  imageUrl?: string | null;
  imagePaths?: string[];
  error?: string;
};

export function VariationChat({
  variationId,
  requestId,
  posterUrls,
  posterType,
  initialMessages,
  roundsUsed,
  maxRounds,
  canChat,
}: {
  variationId: string;
  requestId: string;
  posterUrls: string[];
  posterType: "single" | "carousel" | "reel";
  initialMessages: ChatMessage[];
  roundsUsed: number;
  maxRounds: number;
  canChat: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUrls, setCurrentUrls] = useState(posterUrls);
  const [rounds, setRounds] = useState(roundsUsed);
  const [activePage, setActivePage] = useState(0);
  // Lightbox holds the full set of URLs plus the page being viewed, so you can
  // page through a whole carousel without closing and reopening the preview.
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  function stepLightbox(delta: number) {
    setLightbox((lb) =>
      lb
        ? { ...lb, index: Math.min(Math.max(lb.index + delta, 0), lb.urls.length - 1) }
        : lb,
    );
  }

  // Keyboard navigation while the lightbox is open: ← → to page, Esc to close.
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowRight") stepLightbox(1);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  async function pollForResponse(messageId: string): Promise<void> {
    // Reels take 3-5 min to re-render; posters take ~60s
    const isReel = posterType === "reel";
    const firstPollMs = isReel ? 120000 : 60000;
    const intervalMs = isReel ? 60000 : 30000;
    const maxAttempts = isReel ? 8 : 10;

    await new Promise((r) => setTimeout(r, firstPollMs));

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`/api/ai/chat?message_id=${messageId}`);
        const data = (await res.json()) as PollResponse;

        if (data.status === "complete" && data.message) {
          const assistantMsg: ChatMessage = {
            id: `resp-${Date.now()}`,
            role: "assistant",
            content: data.message,
            imageUrls: data.imageUrl ? [data.imageUrl] : [],
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);

          if (data.imageUrl) {
            setCurrentUrls((prev) => {
              const updated = [...prev];
              if (posterType === "carousel") {
                // Carousel: replace the specific page that was edited
                updated[activePage] = data.imageUrl!;
              } else {
                // Single: replace the preview with the latest edit
                updated[0] = data.imageUrl!;
              }
              return updated;
            });
          }

          setTimeout(() => {
            scrollRef.current?.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: "smooth",
            });
          }, 100);
          return;
        }
      } catch {
        // Network error — keep polling
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    setError("Edit is taking longer than expected. Refresh the page to check.");
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    if (rounds >= maxRounds) {
      setError("Maximum edit rounds reached.");
      return;
    }

    setError(null);
    setSending(true);

    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      imageUrls: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      // Submit the message — returns immediately
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variation_id: variationId,
          message: text,
          page_index: posterType === "carousel" ? activePage : undefined,
        }),
      });

      const data = (await res.json()) as SubmitResponse;

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong.");
        setSending(false);
        return;
      }

      setRounds(maxRounds - data.roundsRemaining);

      // Poll for the assistant's response
      await pollForResponse(data.userMessageId);
    } catch {
      setError("Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Fullscreen lightbox — page through the whole set without reopening */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90"
          onClick={() => setLightbox(null)}
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(dx) > 40) stepLightbox(dx < 0 ? 1 : -1);
          }}
        >
          {/* Top bar — safe from notch, large touch targets */}
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between gap-3 px-4 pb-3 pt-[env(safe-area-inset-top,12px)]">
            {lightbox.urls.length > 1 ? (
              <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-medium tabular-nums text-white">
                {lightbox.index + 1} / {lightbox.urls.length}
              </span>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(lightbox.urls[lightbox.index], "_blank");
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white active:bg-white/40"
                title="Download"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6">
                  <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                  <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white active:bg-white/40"
                aria-label="Close preview"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {lightbox.index > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                stepLightbox(-1);
              }}
              className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/40"
              aria-label="Previous page"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          {lightbox.index < lightbox.urls.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                stepLightbox(1);
              }}
              className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white active:bg-white/40"
              aria-label="Next page"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          )}

          <img
            src={lightbox.urls[lightbox.index]}
            alt={`Page ${lightbox.index + 1}`}
            className="max-h-[80vh] max-w-[95vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Media preview */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {posterType === "reel" ? (
          /* Reel preview — video player */
          <div className="flex justify-center">
            <video
              controls
              playsInline
              className="max-h-[50vh] w-full max-w-80 rounded-lg"
              src={currentUrls[0]}
            />
          </div>
        ) : (
          /* Poster/carousel preview — image thumbnails */
          <>
            <div className={`flex gap-3 ${currentUrls.length === 1 ? "justify-center" : "overflow-x-auto pb-2"}`}>
              {currentUrls.map((url, i) => (
                <div key={i} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActivePage(i)}
                    className={`overflow-hidden rounded-lg transition-all ${
                      activePage === i
                        ? "ring-2 ring-violet-600 ring-offset-2 dark:ring-offset-zinc-900"
                        : "opacity-70 hover:opacity-100"
                    } ${currentUrls.length === 1 ? "w-full max-w-80" : "w-44 sm:w-52"}`}
                  >
                    <img
                      src={url}
                      alt={`Page ${i + 1}`}
                      className="w-full object-contain"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLightbox({ urls: currentUrls, index: i })}
                    className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
                    style={{ opacity: 1 }}
                    title="View full size"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </button>
                  {currentUrls.length > 1 && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {i + 1}/{currentUrls.length}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {currentUrls.length > 1 && (
              <p className="mt-2 text-center text-[10px] text-zinc-400">
                Click a page to select it for editing
              </p>
            )}
          </>
        )}

        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-zinc-500">
            {rounds}/{maxRounds} edits used
          </p>
          {currentUrls.length > 1 && (
            <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
              Editing page {activePage + 1}
            </p>
          )}
        </div>
      </div>

      {/* Chat pod */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="space-y-3 overflow-y-auto p-4"
          style={{ maxHeight: "40vh", minHeight: "200px" }}
        >
          {messages.length === 0 && (
            <p className="text-center text-xs text-zinc-400 py-8">
              Describe the changes you&apos;d like to make to this poster.
              {currentUrls.length > 1 && " Select a page above first."}
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-violet-600 text-white"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.imageUrls.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {msg.imageUrls.map((url, i) => (
                      posterType === "reel" ? (
                        <video
                          key={i}
                          controls
                          playsInline
                          className="h-40 w-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
                          src={url}
                        />
                      ) : (
                        <img
                          key={i}
                          src={url}
                          alt="Updated poster"
                          onClick={() => setLightbox({ urls: msg.imageUrls, index: i })}
                          className="h-40 w-auto cursor-pointer rounded-lg border border-zinc-200 object-contain hover:opacity-80 dark:border-zinc-700"
                        />
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-zinc-100 px-4 py-2.5 dark:bg-zinc-800">
                <div className="flex items-center gap-1.5">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                  <div
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <div
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Reel re-render notice */}
        {posterType === "reel" && canChat && rounds < maxRounds && (
          <div className="px-4">
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Reel edits require re-rendering the video (3-5 minutes per edit).
            </p>
          </div>
        )}

        {/* Input */}
        {canChat && rounds < maxRounds ? (
          <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                posterType === "reel"
                  ? "Describe the change (e.g., speed up transitions, change music mood)..."
                  : currentUrls.length > 1
                  ? `Describe changes for page ${activePage + 1}...`
                  : "Describe the change you want..."
              }
              disabled={sending}
              className="flex-1 rounded-full border border-zinc-300 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:bg-zinc-900"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
            >
              {sending ? "..." : "Send"}
            </button>
          </div>
        ) : rounds >= maxRounds ? (
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-center text-xs text-zinc-500">
              Maximum edit rounds reached. Go back and accept a variation.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
