"use client";

import { useState, useTransition, type ReactNode } from "react";

export type AssetItem = {
  id: string;
  kind: "upload" | "design";
  name: string;
  signedUrl: string | null;
  mimeType: string | null;
  byteSize?: number | null;
  version?: number;
  // Server action and hidden form fields to render under each tile, if
  // the caller wants to expose a Remove control. Server actions are
  // referenced by the parent and forwarded as opaque function refs.
  removeAction?: (formData: FormData) => void | Promise<void>;
  removeFields?: Record<string, string>;
  removeConfirm?: string;
  // Rendered under the preview (designs use this for the upload notes).
  footerText?: string | null;
};

type Props = {
  requestId: string;
  items: AssetItem[];
  // Heading rendered above the toolbar.
  heading: ReactNode;
  // For the design list we render a version chip above the preview.
  showVersion?: boolean;
};

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function isImage(mime: string | null, name: string): boolean {
  if (mime?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}

function isVideo(mime: string | null, name: string): boolean {
  if (mime?.startsWith("video/")) return true;
  return /\.(mp4|mov|webm)$/i.test(name);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (data:mime;base64,)
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.Capacitor?.isNativePlatform?.()
  );
}

/**
 * On mobile (Capacitor WebView), open the signed URL directly in the
 * system browser. The browser handles the download natively. For single
 * files we use the signedUrl from the asset item. For multi-file we
 * fall back to the blob approach which may not work on all devices.
 */
function mobileDownloadSingleFile(signedUrl: string): void {
  // Open in system browser — this triggers Android's native download
  // manager which works reliably across all devices.
  window.open(signedUrl, "_blank");
}

async function triggerDownload(
  requestId: string,
  items: { id: string; kind: AssetItem["kind"] }[],
  signedUrl?: string | null,
): Promise<void> {
  // Mobile single-file: open signed URL directly in system browser.
  // This is the most reliable approach on Android WebView.
  if (isNativeApp() && items.length === 1 && signedUrl) {
    mobileDownloadSingleFile(signedUrl);
    return;
  }

  const res = await fetch("/api/assets/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ requestId, items }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Download failed (${res.status})`);
  }
  const blob = await res.blob();

  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(cd);
  const filename =
    (match?.[1] && decodeURIComponent(match[1])) ||
    (items.length === 1 ? "asset" : "assets.zip");

  if (isNativeApp()) {
    // Multi-file on mobile: try Capacitor plugins, then blob fallback
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      const base64 = await blobToBase64(blob);
      await Filesystem.writeFile({
        path: `Download/${filename}`,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      alert(`Saved to Downloads/${filename}`);
    } catch {
      // Plugins not available — convert to data URL and open
      const base64 = await blobToBase64(blob);
      const dataUrl = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
      window.open(dataUrl, "_blank");
    }
  } else {
    // Web: standard blob + anchor trick
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Hand the blob back to the GC promptly — important for video downloads.
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export function AssetDownloadGrid({
  requestId,
  items,
  heading,
  showVersion,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Tracks which single-item quick-download is in-flight so we can spin
  // just that tile rather than the whole grid.
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return null;

  const allSelected = selected.size === items.length;
  const selectionCount = selected.size;

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }

  function downloadSelected() {
    if (selectionCount === 0) return;
    const payload = items
      .filter((i) => selected.has(i.id))
      .map((i) => ({ id: i.id, kind: i.kind }));
    setError(null);
    startTransition(async () => {
      try {
        const singleItem = payload.length === 1
          ? items.find((i) => i.id === payload[0].id)
          : undefined;
        await triggerDownload(requestId, payload, singleItem?.signedUrl);
        setSelected(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed.");
      }
    });
  }

  async function downloadOne(item: AssetItem) {
    setError(null);
    setBusyId(item.id);
    try {
      await triggerDownload(requestId, [{ id: item.id, kind: item.kind }], item.signedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {heading}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <button
            type="button"
            onClick={downloadSelected}
            disabled={selectionCount === 0 || pending}
            className={`rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-600 ${
              pending
                ? "cursor-progress"
                : selectionCount === 0
                  ? "cursor-not-allowed"
                  : "cursor-pointer"
            }`}
          >
            {pending
              ? "Preparing…"
              : selectionCount === 0
                ? "Download"
                : selectionCount === 1
                  ? "Download 1 file"
                  : `Download ${selectionCount} files (.zip)`}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((item) => {
          const checked = selected.has(item.id);
          const url = item.signedUrl;
          const img = isImage(item.mimeType, item.name);
          const vid = !img && isVideo(item.mimeType, item.name);
          const isBusy = busyId === item.id;
          return (
            <li
              key={item.id}
              onClick={() => toggleOne(item.id)}
              role="button"
              tabIndex={0}
              aria-pressed={checked}
              aria-label={`Select ${item.name}`}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  toggleOne(item.id);
                }
              }}
              className={`relative cursor-pointer overflow-hidden rounded-lg border bg-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:bg-zinc-900 ${
                checked
                  ? "border-violet-500 ring-2 ring-violet-300 dark:border-violet-400 dark:ring-violet-500/40"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <label
                onClick={(e) => e.stopPropagation()}
                className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-white/90 shadow-sm dark:bg-zinc-900/90"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(item.id)}
                  className="h-4 w-4 cursor-pointer rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                  aria-label={`Select ${item.name}`}
                />
              </label>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadOne(item);
                }}
                disabled={isBusy}
                aria-label={`Download ${item.name}`}
                className="absolute right-2 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-white/90 text-zinc-700 shadow-sm hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-violet-400"
                title="Download this file"
              >
                {isBusy ? (
                  <span className="block h-3 w-3 animate-spin rounded-full border-2 border-zinc-300 border-t-violet-600" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-4 w-4"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>

              {showVersion && item.version !== undefined && (
                <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    v{item.version}
                  </span>
                </div>
              )}

              {url && img && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={item.name}
                  className="aspect-square w-full object-cover"
                />
              )}
              {url && vid && (
                <video
                  src={url}
                  controls
                  onClick={(e) => e.stopPropagation()}
                  className="aspect-square w-full object-cover"
                />
              )}
              {url && !img && !vid && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="block aspect-square w-full bg-zinc-100 p-3 text-center text-xs text-zinc-600 hover:underline dark:bg-zinc-800 dark:text-zinc-300"
                >
                  Open file →
                </a>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-800">
                <span className="truncate" title={item.name}>
                  {item.byteSize !== undefined && item.byteSize !== null
                    ? formatBytes(item.byteSize)
                    : item.name}
                </span>
                {item.removeAction && (
                  <RemoveForm
                    action={item.removeAction}
                    fields={item.removeFields ?? {}}
                    confirmMessage={item.removeConfirm}
                  />
                )}
              </div>
              {item.footerText && (
                <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                  {item.footerText}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Inline remove form. Confirms in the browser before submitting so we
// don't bring in the heavier ConfirmForm dialog component just for this.
function RemoveForm({
  action,
  fields,
  confirmMessage,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  confirmMessage?: string;
}) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      e.preventDefault();
    }
  }
  return (
    <form
      action={action}
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className="cursor-pointer text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
      >
        Remove
      </button>
    </form>
  );
}

export { formatDate };
