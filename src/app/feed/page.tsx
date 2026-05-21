import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SocialPlatform, UserRole } from "@/lib/supabase/types";

type PublishedRequest = {
  id: string;
  title: string;
  description: string | null;
  school_id: string;
  updated_at: string;
};

type SchoolLite = { id: string; name: string };
type UploadRow = {
  request_id: string;
  storage_path: string;
  mime_type: string | null;
};
type LinkRow = {
  request_id: string;
  id: string;
  platform: SocialPlatform;
  url: string;
  posted_at: string;
};

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const FEED_LIMIT = 50;

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  twitter: "Twitter / X",
  youtube: "YouTube",
  other: "Link",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function FeedPage() {
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

  const { data: requests } = await supabase
    .from("requests")
    .select("id, title, description, school_id, updated_at")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(FEED_LIMIT)
    .returns<PublishedRequest[]>();

  const requestList = requests ?? [];

  if (requestList.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Published
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Everything that's gone out for your school.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Nothing published yet.
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Once the design team publishes a post, it'll show up here.
          </p>
        </div>
      </div>
    );
  }

  const schoolIds = Array.from(new Set(requestList.map((r) => r.school_id)));
  const requestIds = requestList.map((r) => r.id);

  const [{ data: schools }, { data: uploads }, { data: links }] =
    await Promise.all([
      supabase
        .from("schools")
        .select("id, name")
        .in("id", schoolIds)
        .returns<SchoolLite[]>(),
      supabase
        .from("request_uploads")
        .select("request_id, storage_path, mime_type")
        .in("request_id", requestIds)
        .returns<UploadRow[]>(),
      supabase
        .from("published_links")
        .select("request_id, id, platform, url, posted_at")
        .in("request_id", requestIds)
        .order("posted_at", { ascending: true })
        .returns<LinkRow[]>(),
    ]);

  const schoolById = new Map((schools ?? []).map((s) => [s.id, s.name]));
  const uploadsByRequest = new Map<string, UploadRow[]>();
  for (const u of uploads ?? []) {
    const list = uploadsByRequest.get(u.request_id) ?? [];
    list.push(u);
    uploadsByRequest.set(u.request_id, list);
  }
  const linksByRequest = new Map<string, LinkRow[]>();
  for (const l of links ?? []) {
    const list = linksByRequest.get(l.request_id) ?? [];
    list.push(l);
    linksByRequest.set(l.request_id, list);
  }

  const allUploadPaths = (uploads ?? []).map((u) => u.storage_path);
  const signedUrlByPath = new Map<string, string>();
  if (allUploadPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("request-uploads")
      .createSignedUrls(allUploadPaths, SIGNED_URL_TTL_SECONDS);
    for (const e of signed ?? []) {
      if (e.signedUrl && e.path) signedUrlByPath.set(e.path, e.signedUrl);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Published
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {role === "decision_maker"
            ? "Everything that's gone out for your school."
            : `Latest ${requestList.length} published.`}
        </p>
      </div>

      <ul className="space-y-6">
        {requestList.map((r) => {
          const schoolName = schoolById.get(r.school_id) ?? "";
          const photos = uploadsByRequest.get(r.id) ?? [];
          const photoLinks = linksByRequest.get(r.id) ?? [];
          return (
            <li
              key={r.id}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="px-4 py-3">
                <p className="text-xs text-zinc-500">
                  {schoolName} · {formatDate(r.updated_at)}
                </p>
                <h2 className="mt-1 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {r.title}
                </h2>
                {r.description && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
                    {r.description}
                  </p>
                )}
              </div>

              {photos.length > 0 && (
                <ul className="flex gap-1 overflow-x-auto border-t border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950/40">
                  {photos.map((u) => {
                    const url = signedUrlByPath.get(u.storage_path);
                    if (!url) return null;
                    const isImage = (u.mime_type ?? "").startsWith("image/");
                    const isVideo = (u.mime_type ?? "").startsWith("video/");
                    if (!isImage && !isVideo) return null;
                    return (
                      <li
                        key={u.storage_path}
                        className="h-24 w-24 shrink-0 overflow-hidden rounded"
                      >
                        {isImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <video
                            src={url}
                            className="h-full w-full object-cover"
                            muted
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {photoLinks.length > 0 && (
                <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                  {photoLinks.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                    >
                      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-500">
                        {PLATFORM_LABEL[l.platform]}
                      </span>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        View on {PLATFORM_LABEL[l.platform]} →
                      </a>
                    </li>
                  ))}
                </ul>
              )}

              {role !== "decision_maker" && (
                <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
                  <Link
                    href={`/requests/${r.id}`}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Open request →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
