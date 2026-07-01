"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachBrandAsset } from "../actions";
import { toast } from "sonner";
import type { BrandAssetType } from "@/lib/supabase/types";

const MAX_FILE_BYTES = 150 * 1024 * 1024;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function BrandAssetUpload({
  schoolId,
  assetType,
}: {
  schoolId: string;
  assetType: BrandAssetType;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 150 MB.`);
      e.target.value = "";
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const supabase = createClient();

      for (const file of files) {
        const path = `${schoolId}/${assetType}/${Date.now()}-${sanitizeName(file.name)}`;

        const { error: upErr } = await supabase.storage
          .from("school-assets")
          .upload(path, file, {
            contentType: file.type || undefined,
            upsert: false,
          });

        if (upErr) {
          const m = `${file.name}: ${upErr.message}`;
          setError(m);
          toast.error(m);
          continue;
        }

        const fd = new FormData();
        fd.set("school_id", schoolId);
        fd.set("asset_type", assetType);
        fd.set("storage_path", path);
        fd.set("mime_type", file.type || "");
        fd.set("file_size", String(file.size));
        fd.set("label", file.name);
        await attachBrandAsset(fd);
      }

      toast.success("Brand asset uploaded");
      router.refresh();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Upload failed.";
      setError(m);
      toast.error(m);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onFilesSelected}
        className="sr-only"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {busy ? "Uploading…" : "+ Upload"}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
