export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/auth";
import { VariationChat } from "../../variation-chat";
import { BackLink } from "@/components/back-link";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  image_paths: string[];
  created_at: string;
};

export default async function VariationChatPage({
  params,
}: {
  params: Promise<{ id: string; variationId: string }>;
}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const { id: requestId, variationId } = await params;
  const supabase = await createClient();

  const { data: variation } = await supabase
    .from("ai_variations")
    .select(
      "id, request_id, variation_index, creative_brief, storage_paths, poster_type, chat_rounds_used",
    )
    .eq("id", variationId)
    .eq("request_id", requestId)
    .single();

  if (!variation) notFound();

  const { data: req } = await supabase
    .from("requests")
    .select("title, created_by, assigned_designer_id")
    .eq("id", requestId)
    .single();

  if (!req) notFound();

  const { data: messages } = await supabase
    .from("ai_chat_messages")
    .select("id, role, content, image_paths, created_at")
    .eq("variation_id", variationId)
    .order("created_at", { ascending: true })
    .returns<ChatMessage[]>();

  // For carousel: sign all page URLs. For single: only the latest version
  // (chat edits append to storage_paths, so [0] is original, [1+] are edits)
  const posterUrls: string[] = [];
  const isSingle = (variation.poster_type as string) === "single";
  const pathsToSign = isSingle
    ? [variation.storage_paths[variation.storage_paths.length - 1]]
    : variation.storage_paths;
  for (const path of pathsToSign) {
    if (!path) continue;
    const { data } = await supabase.storage
      .from("designs")
      .createSignedUrl(path, 3600);
    if (data?.signedUrl) posterUrls.push(data.signedUrl);
  }

  // Sign image URLs in chat messages (1hr TTL to avoid expiry during long sessions)
  const messageImageUrls = new Map<string, string>();
  for (const msg of messages ?? []) {
    for (const path of msg.image_paths) {
      const { data } = await supabase.storage
        .from("designs")
        .createSignedUrl(path, 3600);
      if (data?.signedUrl) messageImageUrls.set(path, data.signedUrl);
    }
  }

  const brief = variation.creative_brief as {
    direction?: string;
    theme?: string;
  };
  const isDesigner = req.assigned_designer_id === session.id;
  const isSuperAdmin = session.role === "super_admin";
  const canChat = isDesigner || isSuperAdmin;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <BackLink href={`/requests/${requestId}`}>
        {req.title}
      </BackLink>

      <div className="mt-2 mb-4">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Edit Variation {variation.variation_index}
          {brief.direction && (
            <span className="ml-2 text-sm font-normal text-zinc-500">
              — {brief.direction}
            </span>
          )}
        </h1>
        <p className="text-xs text-zinc-500">
          {variation.chat_rounds_used}/25 edits used ·{" "}
          {variation.poster_type === "carousel"
            ? `${variation.storage_paths.length} pages`
            : "Single poster"}
        </p>
      </div>

      <VariationChat
        variationId={variationId}
        requestId={requestId}
        posterUrls={posterUrls}
        posterType={variation.poster_type as "single" | "carousel"}
        initialMessages={(messages ?? []).map((m) => ({
          ...m,
          imageUrls: m.image_paths
            .map((p) => messageImageUrls.get(p))
            .filter(Boolean) as string[],
        }))}
        roundsUsed={variation.chat_rounds_used}
        maxRounds={25}
        canChat={canChat}
      />
    </div>
  );
}
