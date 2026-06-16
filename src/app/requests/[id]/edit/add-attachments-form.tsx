"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachUpload } from "../../actions";
import { toast } from "sonner";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function AddAttachmentsForm({
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

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 25 MB — pick something smaller.`);
      return;
    }

    setError(null);
    setBusy(true);
    setProgress(`Uploading 0 / ${files.length}…`);

    const supabase = createClient();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = `${schoolId}/${requestId}/${Date.now()}-${sanitizeName(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from("request-uploads")
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (upErr) {
        const m = `Couldn't upload ${file.name}: ${upErr.message}`;
        setError(m);
        toast.error(m);
        setBusy(false);
        setProgress(null);
        router.refresh();
        return;
      }
      const attachData = new FormData();
      attachData.set("request_id", requestId);
      attachData.set("storage_path", path);
      attachData.set("mime_type", file.type || "");
      attachData.set("file_size", String(file.size));
      await attachUpload(attachData);
      setProgress(`Uploading ${i + 1} / ${files.length}…`);
    }

    setBusy(false);
    setProgress(null);
    toast.success("Attachments uploaded");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        onChange={onPick}
        className="sr-only"
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {busy ? (progress ?? "Uploading…") : "+ Add more"}
      </button>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
