import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { RequestStatus, UserRole } from "@/lib/supabase/types";
import { removeUpload, updateRequestDraft } from "../../actions";
import { AddAttachmentsForm } from "./add-attachments-form";

type RequestRow = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  status: RequestStatus;
};

type UploadRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: string;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60;

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function EditRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "teacher";

  const { data: req } = await supabase
    .from("requests")
    .select("id, created_by, title, description, status")
    .eq("id", id)
    .single<RequestRow>();
  if (!req) notFound();

  const canEdit =
    req.status === "draft" &&
    (req.created_by === user.id || role === "super_admin");
  if (!canEdit) redirect(`/requests/${id}`);

  const { data: uploads } = await supabase
    .from("request_uploads")
    .select("id, storage_path, mime_type, file_size, uploaded_by")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .returns<UploadRow[]>();

  const uploadsList = uploads ?? [];
  const signedUrlByPath = new Map<string, string>();
  if (uploadsList.length > 0) {
    const { data: signedList } = await supabase.storage
      .from("request-uploads")
      .createSignedUrls(
        uploadsList.map((u) => u.storage_path),
        SIGNED_URL_TTL_SECONDS,
      );
    for (const entry of signedList ?? []) {
      if (entry.signedUrl && entry.path) {
        signedUrlByPath.set(entry.path, entry.signedUrl);
      }
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/requests/${req.id}`}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← Back to request
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Edit draft
        </h1>
      </div>

      <form action={updateRequestDraft} className="space-y-4">
        <input type="hidden" name="id" value={req.id} />
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={req.title}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Notes
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            defaultValue={req.description ?? ""}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Save changes
        </button>
      </form>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Attachments ({uploadsList.length})
        </h2>
        {uploadsList.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {uploadsList.map((u) => {
              const url = signedUrlByPath.get(u.storage_path);
              const isImage = (u.mime_type ?? "").startsWith("image/");
              const isVideo = (u.mime_type ?? "").startsWith("video/");
              const name = u.storage_path.split("/").pop() ?? "file";
              const canDelete =
                u.uploaded_by === user.id || role === "super_admin";
              return (
                <li
                  key={u.id}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {url && isImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={name}
                      className="aspect-square w-full object-cover"
                    />
                  )}
                  {url && isVideo && (
                    <video
                      src={url}
                      controls
                      className="aspect-square w-full object-cover"
                    />
                  )}
                  {url && !isImage && !isVideo && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square w-full bg-zinc-100 p-3 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      Open file →
                    </a>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-800">
                    <span className="truncate" title={name}>
                      {formatBytes(u.file_size)}
                    </span>
                    {canDelete && (
                      <form action={removeUpload}>
                        <input type="hidden" name="upload_id" value={u.id} />
                        <input type="hidden" name="request_id" value={req.id} />
                        <input
                          type="hidden"
                          name="storage_path"
                          value={u.storage_path}
                        />
                        <button
                          type="submit"
                          className="text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <AddAttachmentsForm requestId={req.id} />
      </section>
    </div>
  );
}
