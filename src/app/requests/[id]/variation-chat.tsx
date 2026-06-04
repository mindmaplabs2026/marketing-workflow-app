"use client";

import { useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  imageUrls: string[];
  created_at: string;
};

type ChatResponse = {
  message: string;
  imagePaths: string[];
  imageUrl: string | null;
  roundsRemaining: number;
  error?: string;
};

export function VariationChat({
  variationId,
  requestId,
  currentPosterUrl,
  initialMessages,
  roundsUsed,
  maxRounds,
  canChat,
}: {
  variationId: string;
  requestId: string;
  currentPosterUrl: string | null;
  initialMessages: ChatMessage[];
  roundsUsed: number;
  maxRounds: number;
  canChat: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posterUrl, setPosterUrl] = useState(currentPosterUrl);
  const [rounds, setRounds] = useState(roundsUsed);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    if (rounds >= maxRounds) {
      setError("Maximum edit rounds reached.");
      return;
    }

    setError(null);
    setSending(true);

    // Optimistically add user message
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
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variation_id: variationId,
          message: text,
        }),
      });

      const data = (await res.json()) as ChatResponse;

      if (!res.ok || data.error) {
        setError(data.error ?? "Something went wrong.");
        setSending(false);
        return;
      }

      const assistantMsg: ChatMessage = {
        id: `resp-${Date.now()}`,
        role: "assistant",
        content: data.message,
        imageUrls: data.imageUrl ? [data.imageUrl] : [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setRounds(maxRounds - data.roundsRemaining);

      if (data.imageUrl) {
        setPosterUrl(data.imageUrl);
      }

      // Auto-scroll to bottom
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    } catch {
      setError("Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {/* Current poster preview */}
      <div className="shrink-0 sm:w-80">
        <div className="sticky top-4 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt="Current poster"
              className="w-full object-contain"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center text-xs text-zinc-400">
              No preview
            </div>
          )}
          <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">
              {rounds}/{maxRounds} edits used
            </p>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50"
          style={{ maxHeight: "60vh", minHeight: "300px" }}
        >
          {messages.length === 0 && (
            <p className="text-center text-xs text-zinc-400">
              Describe the changes you&apos;d like to make to this poster.
            </p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  msg.role === "user"
                    ? "bg-violet-600 text-white"
                    : "bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.imageUrls.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {msg.imageUrls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt="Updated poster"
                        className="h-32 w-32 rounded border border-zinc-200 object-cover dark:border-zinc-700"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-white px-3 py-2 dark:bg-zinc-800">
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
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {/* Input */}
        {canChat && rounds < maxRounds && (
          <div className="mt-3 flex gap-2">
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
              placeholder="Describe the change you want…"
              disabled={sending}
              className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !input.trim()}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
            >
              {sending ? "…" : "Send"}
            </button>
          </div>
        )}

        {rounds >= maxRounds && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            Maximum edit rounds reached. Accept a variation to proceed.
          </p>
        )}
      </div>
    </div>
  );
}
