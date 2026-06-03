"use client";

import { useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachDesign } from "../actions";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDesignForm({
  requestId,
  schoolId,
}: {
  requestId: string;
  schoolId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const stageFiles = useCallback((files: File[]) => {
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 50 MB — pick something smaller.`);
      return;
    }
    setError(null);
    setStagedFiles(files);
    setPreviews(
      files
        .filter((f) => f.type.startsWith("image/"))
        .map((f) => URL.createObjectURL(f)),
    );
  }, []);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) stageFiles(files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) stageFiles(files);
  }

  function clearStaged() {
    previews.forEach(URL.revokeObjectURL);
    setStagedFiles([]);
    setPreviews([]);
  }

  async function upload() {
    if (stagedFiles.length === 0) return;
    setBusy(true);
    setProgress(`Uploading 0 / ${stagedFiles.length}…`);

    const supabase = createClient();
    for (let i = 0; i < stagedFiles.length; i++) {
      const file = stagedFiles[i];
      const path = `${schoolId}/${requestId}/${Date.now()}-${sanitizeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("designs")
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (upErr) {
        setError(`Couldn't upload ${file.name}: ${upErr.message}`);
        setBusy(false);
        setProgress(null);
        router.refresh();
        return;
      }
      const fd = new FormData();
      fd.set("request_id", requestId);
      fd.set("storage_path", path);
      if (notes) fd.set("notes", notes);
      await attachDesign(fd);
      setProgress(`Uploading ${i + 1} / ${stagedFiles.length}…`);
    }

    setBusy(false);
    setProgress(null);
    setNotes("");
    clearStaged();
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note about this version (what changed, what to look for)"
        disabled={busy}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />

      {stagedFiles.length === 0 ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
              : "border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-zinc-600"
          }`}
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {dragging ? "Drop files here" : "Drag & drop your design here"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            or click to browse · Images, videos, PDFs up to 50 MB
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {previews.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {previews.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={url}
                  alt="Preview"
                  className="h-32 w-auto rounded-md border border-zinc-200 object-contain dark:border-zinc-700"
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              {stagedFiles.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ")}
            </span>
            {!busy && (
              <button
                type="button"
                onClick={clearStaged}
                className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              >
                Remove
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={upload}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? (progress ?? "Uploading…") : "Upload design"}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,application/pdf"
        onChange={onPick}
        className="sr-only"
        disabled={busy}
      />


      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
