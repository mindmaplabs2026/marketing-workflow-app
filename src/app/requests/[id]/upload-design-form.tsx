"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachDesign } from "../actions";

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function UploadDesignForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 50 MB — pick something smaller.`);
      return;
    }

    setError(null);
    setBusy(true);
    setProgress(`Uploading 0 / ${files.length}…`);

    const supabase = createClient();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = `${requestId}/${Date.now()}-${sanitizeName(file.name)}`;
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
      setProgress(`Uploading ${i + 1} / ${files.length}…`);
    }

    setBusy(false);
    setProgress(null);
    setNotes("");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <textarea
        rows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional note about this version (what changed, what to look for)"
        disabled={busy}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,application/pdf"
        onChange={onPick}
        className="sr-only"
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy ? (progress ?? "Uploading…") : "Upload design"}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
