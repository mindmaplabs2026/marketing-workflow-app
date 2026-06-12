"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { acceptAiVariation } from "../actions";

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
  poster_type: "single" | "carousel";
  is_accepted: boolean;
  chat_rounds_used: number;
};

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
  const [variations, setVariations] = useState(initialVariations);
  const [signedUrls, setSignedUrls] = useState<Map<string, string[]>>(
    new Map(),
  );
  const [accepting, setAccepting] = useState<string | null>(null);
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
          const { data } = await supabase.storage
            .from("designs")
            .createSignedUrl(path, 3600);
          if (data?.signedUrl) urls.push(data.signedUrl);
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
      router.refresh();
    } catch {
      setAccepting(null);
    }
  }

  const accepted = variations.find((v) => v.is_accepted);

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
              <img
                key={i}
                src={url}
                alt={`Accepted poster page ${i + 1}`}
                className="h-40 w-40 rounded-md border border-emerald-200 object-cover dark:border-emerald-900/50"
              />
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {variations.map((v) => {
          const allUrls = signedUrls.get(v.id) ?? [];
          // Single posters: chat edits are appended (history) — show only the
          // LATEST version. Carousels: show every page.
          const urls = v.poster_type === "single" ? allUrls.slice(-1) : allUrls;
          const brief = v.creative_brief;
          const idx = carouselIndex.get(v.id) ?? 0;

          return (
            <div
              key={v.id}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              {/* Image preview */}
              <div className="relative aspect-square bg-zinc-100 dark:bg-zinc-800">
                {urls.length > 0 ? (
                  <>
                    <img
                      src={urls[idx]}
                      alt={`Variation ${v.variation_index}`}
                      className="h-full w-full object-cover"
                    />
                    {urls.length > 1 && (
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
              <div className="space-y-2 p-3">
                <p className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                  {brief.direction ?? `Variation ${v.variation_index}`}
                </p>
                {brief.textContent?.headline && (
                  <p className="text-xs text-zinc-500 line-clamp-2">
                    &ldquo;{brief.textContent.headline}&rdquo;
                  </p>
                )}
                {brief.colorPalette && brief.colorPalette.length > 0 && (
                  <div className="flex gap-1">
                    {brief.colorPalette.slice(0, 5).map((hex, i) => (
                      <div
                        key={i}
                        className="h-4 w-4 rounded-full border border-zinc-200 dark:border-zinc-700"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-zinc-400">
                  {v.poster_type === "carousel"
                    ? `${v.storage_paths.length} pages`
                    : "Single poster"}
                  {v.chat_rounds_used > 0 &&
                    ` · ${v.chat_rounds_used}/25 edits used`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
                <a
                  href={`/requests/${requestId}/chat/${v.id}`}
                  className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-center text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Chat &amp; Edit
                </a>
                <button
                  type="button"
                  disabled={accepting !== null}
                  onClick={() => handleAccept(v.id)}
                  className="flex-1 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600"
                >
                  {accepting === v.id ? "Accepting…" : "Accept"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
