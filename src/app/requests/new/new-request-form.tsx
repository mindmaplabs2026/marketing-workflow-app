"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { attachUpload, createRequest } from "../actions";

type School = { id: string; name: string };

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function NewRequestForm({ schools }: { schools: School[] }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    const tooBig = list.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is over 25 MB — pick something smaller.`);
      return;
    }
    setError(null);
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      setError("Give the request a short title.");
      return;
    }

    setBusy(true);

    try {
      const created = await createRequest({}, formData);
      if (created.error || !created.requestId) {
        setError(created.error ?? "Could not create request.");
        setBusy(false);
        return;
      }
      const requestId = created.requestId;

      if (files.length > 0) {
        setProgress(`Uploading 0 / ${files.length}…`);
        const supabase = createClient();
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const path = `${requestId}/${Date.now()}-${sanitizeName(file.name)}`;
          const { error: upErr } = await supabase.storage
            .from("request-uploads")
            .upload(path, file, {
              contentType: file.type || undefined,
              upsert: false,
            });
          if (upErr) {
            setError(`Couldn't upload ${file.name}: ${upErr.message}`);
            setBusy(false);
            setProgress(null);
            router.push(`/requests/${requestId}`);
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
      }

      router.push(`/requests/${requestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      {schools.length > 1 ? (
        <div>
          <label
            htmlFor="school_id"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            School
          </label>
          <select
            id="school_id"
            name="school_id"
            required
            defaultValue={schools[0].id}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input type="hidden" name="school_id" value={schools[0].id} />
      )}

      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          What's this about?
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          autoFocus
          placeholder="e.g. Annual sports day post"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="request_type"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Type <span className="text-zinc-400">(optional)</span>
          </label>
          <select
            id="request_type"
            name="request_type"
            defaultValue=""
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="">Select type...</option>
            <option value="social_post">Social post</option>
            <option value="poster">Poster</option>
            <option value="newsletter">Newsletter</option>
            <option value="video">Video</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="due_date"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Due date <span className="text-zinc-400">(optional)</span>
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="description"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Anything the team should know? <span className="text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          placeholder="Date, hashtags, key names to mention…"
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <div>
        <p className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Photos or videos <span className="text-zinc-400">(optional)</span>
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={onPickFiles}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-1 inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          + Add files
        </button>

        {files.length > 0 && (
          <ul className="mt-3 space-y-1">
            {files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="truncate text-zinc-700 dark:text-zinc-300">
                  {f.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="ml-2 shrink-0 text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-violet-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-600"
        >
          {busy ? (progress ?? "Saving…") : "Save"}
        </button>
        {!busy && (
          <a
            href="/requests"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Cancel
          </a>
        )}
      </div>
    </form>
  );
}
