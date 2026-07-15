/**
 * Shared chat-edit logic (Codex Poster Bridge — Phase 3b).
 *
 * The "chat & edit" redesign ("make the logo bigger") is the same in both modes;
 * only WHO runs it differs. This function holds the logic so it can be called by:
 *   - the Inngest function aiChatEdit (POSTER_ENGINE=inngest, on Vercel), and
 *   - the standalone worker (POSTER_ENGINE=server).
 *
 * Image calls go through the model client, so MODEL_ENGINE controls whether the
 * edit uses OpenAI or Codex — identical to the generation path.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getModelClient } from "./model-client";
import { getModelEngineKind } from "../config/engine";
import { toFile } from "openai";
import { compositeOriginalPhotos, defaultPhotoFrames } from "./poster-compositor";

export type ChatEditInput = {
  variationId: string;
  message: string;
  pageIndex: number | null;
  /**
   * Storage paths (in the `designs` bucket) of user-attached reference images —
   * annotated screenshots pointing at the exact scene/element to change.
   */
  attachmentPaths?: string[];
};

/** Download user-attached reference images from the `designs` bucket (best-effort). */
async function downloadAttachments(
  admin: ReturnType<typeof createAdminClient>,
  attachmentPaths: string[] | undefined,
): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const p of attachmentPaths ?? []) {
    if (!p) continue;
    try {
      const { data, error } = await admin.storage.from("designs").download(p);
      if (error || !data) {
        console.warn(`[chat-edit] attachment download failed: ${p} (${error?.message ?? "no data"})`);
        continue;
      }
      buffers.push(Buffer.from(await data.arrayBuffer()));
    } catch (e) {
      console.warn(`[chat-edit] attachment download errored: ${p} (${e instanceof Error ? e.message : e})`);
    }
  }
  return buffers;
}

export async function runChatEdit({ variationId, message, pageIndex, attachmentPaths }: ChatEditInput): Promise<void> {
  const startTime = Date.now();
  console.log(`[chat-edit] ── START ── variation=${variationId}, message="${message.slice(0, 80)}${message.length > 80 ? "..." : ""}", ${attachmentPaths?.length ?? 0} attachment(s)`);

  const admin = createAdminClient();
  const openai = await getModelClient();

  const { data: variation } = await admin
    .from("ai_variations")
    .select("id, job_id, request_id, variation_index, storage_paths, poster_type, chat_rounds_used, creative_brief")
    .eq("id", variationId)
    .single();

  if (!variation) throw new Error("Variation not found");
  const requestId = variation.request_id;

  // User-attached reference/annotation images (best-effort — a missing one just
  // means that engine gets fewer references, never a hard failure).
  const referenceImages = await downloadAttachments(admin, attachmentPaths);

  // Route reel edits to the reel-specific chat path
  if (variation.poster_type === "reel") {
    await runReelChatEdit(variation, message, referenceImages);
    return;
  }
  console.log(`[chat-edit] Variation v${variation.variation_index}, ${variation.poster_type}, ${variation.storage_paths.length} pages, round ${variation.chat_rounds_used + 1}/25`);

  // Determine which page to edit.
  // Single posters: always edit the latest version (last in storage_paths).
  // Carousel: edit the specific page the user selected.
  const isSingle = variation.poster_type === "single";
  let editIndex: number;
  if (isSingle) {
    editIndex = variation.storage_paths.length - 1;
  } else {
    editIndex = pageIndex ?? 0;
    if (editIndex >= variation.storage_paths.length) {
      editIndex = variation.storage_paths.length - 1;
    }
  }

  // Conversation history
  const { data: history } = await admin
    .from("ai_chat_messages")
    .select("role, content")
    .eq("variation_id", variationId)
    .order("created_at", { ascending: true });

  // Step 1: short text confirmation of what will change
  const pageNote = isSingle ? "" : ` The user is editing page ${editIndex + 1} of a ${variation.storage_paths.length}-page carousel.`;
  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are a poster design editing assistant. The user wants minor tweaks to an existing poster.${pageNote} Respond briefly confirming what you'll change. Do NOT list the full design — just confirm the specific edit. Keep it to 1-2 sentences.`,
    },
  ];
  for (const msg of history ?? []) {
    chatMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  console.log(`[chat-edit] Step 1: Getting text confirmation (${history?.length ?? 0} messages in history)`);
  const chatResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: chatMessages,
    max_tokens: 200,
  });
  const assistantText = chatResponse.choices[0]?.message?.content ?? "Applying your edit...";
  console.log(`[chat-edit] Step 1 done: "${assistantText}"`);

  // Step 2: download the page being edited
  const currentPath = variation.storage_paths[editIndex];
  if (!currentPath) throw new Error("No poster page to edit");

  console.log(`[chat-edit] Step 2: Downloading page ${editIndex + 1} — ${currentPath}`);
  const { data: imgData } = await admin.storage.from("designs").download(currentPath);
  if (!imgData) throw new Error("Could not download current poster");
  const currentImageBuffer = Buffer.from(await imgData.arrayBuffer());
  console.log(`[chat-edit] Step 2 done: Downloaded ${(currentImageBuffer.length / 1024).toFixed(0)} KB`);
  const file = await toFile(currentImageBuffer, "current-poster.png", { type: "image/png" });

  const { data: jobRow } = await admin
    .from("ai_generation_jobs")
    .select("pipeline_version")
    .eq("id", variation.job_id)
    .single();
  const preserveUploadedPhotos = jobRow?.pipeline_version === "v2" || jobRow?.pipeline_version === "v3";

  // Step 3: targeted image edit
  // Codex: use dedicated chat-edit agent (vision + image gen in one session).
  // OpenAI: use images.edit API (true inpainting).
  let base64Result: string;
  const isCodex = getModelEngineKind() === "codex";

  console.log(`[chat-edit] Step 3: Generating edited image (engine=${isCodex ? "codex" : "openai"}, ${referenceImages.length} reference image(s))`);
  if (isCodex) {
    const { codexChatEdit } = await import("./codex-chat-edit");
    base64Result = await codexChatEdit({
      currentPoster: currentImageBuffer,
      editMessage: message,
      referenceImages,
      size: "1024x1536",
    });
  } else {
    // OpenAI's images.edit takes only the base image (+ optional mask) — there is
    // no slot for a separate annotation image. So when the user attached
    // reference images, run a gpt-4o vision pre-step that reads the current
    // poster + the annotations and rewrites the request into one precise, literal
    // instruction the image edit can then follow.
    let effectiveMessage = message;
    if (referenceImages.length > 0) {
      try {
        const toDataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
        const visionContent: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
        > = [
          {
            type: "text",
            text: `The user wants to edit the CURRENT Instagram poster (the first image). They attached ${referenceImages.length} annotated reference image(s) marking the EXACT area/element to change. Their request: "${message}".\n\nRewrite this as ONE precise, literal editing instruction that names the specific element and the exact change, grounded in what is visible in the images. Output ONLY the instruction — no preamble, no explanation.`,
          },
          { type: "image_url", image_url: { url: toDataUrl(currentImageBuffer) } },
          ...referenceImages.map((b) => ({ type: "image_url" as const, image_url: { url: toDataUrl(b) } })),
        ];
        const vision = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: visionContent }],
          max_tokens: 300,
        });
        const refined = vision.choices[0]?.message?.content?.trim();
        if (refined) {
          effectiveMessage = refined;
          console.log(`[chat-edit] Vision pre-step refined instruction: "${refined.slice(0, 120)}"`);
        }
      } catch (e) {
        console.warn(`[chat-edit] Vision pre-step failed, using raw message: ${e instanceof Error ? e.message : e}`);
      }
    }

    const editPrompt = `This is an existing Instagram poster. Make ONLY this change: ${effectiveMessage}

Keep EVERYTHING else exactly the same — same layout, same images, same colors, same branding, same logo, same header, same footer. Only modify what was specifically requested. The poster dimensions are portrait 1080x1350px.`;

    const response = await openai.images.edit({
      model: "gpt-image-2",
      image: [file],
      prompt: editPrompt,
      n: 1,
      size: "1024x1536",
      quality: "high",
    });

    const item = response.data?.[0];
    base64Result = item?.b64_json ?? "";
    if (!base64Result && item?.url) {
      base64Result = Buffer.from(await (await fetch(item.url)).arrayBuffer()).toString("base64");
    }
  }
  if (!base64Result) throw new Error("Chat edit: no image returned");
  console.log(`[chat-edit] Step 3 done: Got edited image (${(base64Result.length / 1024).toFixed(0)} KB base64)`);

  // Step 4: upload the edited poster (do NOT replace the original)
  const { data: fullReq } = await admin
    .from("requests")
    .select("school_id")
    .eq("id", requestId)
    .single();
  const schoolId = fullReq?.school_id ?? "unknown";

  let imageBuffer: Buffer<ArrayBufferLike> = Buffer.from(base64Result, "base64");
  if (preserveUploadedPhotos) {
    const creativeBrief = variation.creative_brief as {
      selectedImages?: { path?: string }[];
      layout?: { pages?: { selectedImages?: { path?: string }[] }[] };
    };
    const selected = variation.poster_type === "carousel"
      ? (creativeBrief.layout?.pages?.[editIndex]?.selectedImages ?? [])
      : (creativeBrief.selectedImages ?? []);
    const wanted = selected.map((img) => img.path).filter((p): p is string => !!p);

    const { data: uploads } = await admin
      .from("request_uploads")
      .select("storage_path, mime_type")
      .eq("request_id", requestId);

    const matchedUploads = (uploads ?? []).filter((u) => {
      if (u.mime_type && !u.mime_type.startsWith("image/")) return false;
      if (wanted.length === 0) return true;
      const fn = u.storage_path.split("/").pop() ?? "";
      return wanted.some((p) =>
        p === u.storage_path ||
        u.storage_path.endsWith(p) ||
        p.endsWith(fn) ||
        p.split("/").pop() === fn,
      );
    });

    const photos = [];
    for (const u of matchedUploads) {
      const { data: signed } = await admin.storage
        .from("request-uploads")
        .createSignedUrl(u.storage_path, 3600);
      if (!signed?.signedUrl) continue;
      const res = await fetch(signed.signedUrl);
      if (!res.ok) continue;
      photos.push({ path: u.storage_path, buffer: Buffer.from(await res.arrayBuffer()) });
    }

    const frames = defaultPhotoFrames(
      photos.map((p) => p.path),
      editIndex,
      variation.storage_paths.length,
    );
    imageBuffer = await compositeOriginalPhotos({
      background: imageBuffer,
      photos,
      frames,
    });
    console.log(`[chat-edit] V2 photo-preserve: re-composited ${photos.length} original photo(s) after edit`);
  }

  const round = variation.chat_rounds_used + 1;
  const timestamp = Date.now();
  const storagePath = `${schoolId}/${requestId}/ai/${variation.variation_index}/edits/${round}-${timestamp}.png`;
  console.log(`[chat-edit] Step 4: Uploading edited image → ${storagePath}`);
  // Verify the upload BEFORE updating storage_paths. An unchecked failed upload
  // used to leave a dead path (blank page for carousels / broken latest for
  // singles). Retry transient failures; throw on hard failure so the edit is
  // marked failed and the existing design stays live.
  let uploaded = false;
  let lastUploadErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await admin.storage.from("designs").upload(storagePath, imageBuffer, {
      contentType: "image/png",
      upsert: true,
    });
    if (!error) { uploaded = true; break; }
    lastUploadErr = error.message;
    console.warn(`[chat-edit] upload attempt ${attempt}/3 failed: ${error.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  if (!uploaded) {
    throw new Error(`Edit generated but upload failed after 3 attempts (existing design left intact): ${lastUploadErr}`);
  }

  // Store assistant message
  await admin.from("ai_chat_messages").insert({
    variation_id: variationId,
    role: "assistant",
    content: assistantText,
    image_paths: [storagePath],
    metadata: { model: "gpt-image-2", chat_model: "gpt-4o-mini", round },
  });

  // Update storage_paths: single → append; carousel → replace edited page in place
  let updatedPaths: string[];
  if (isSingle) {
    updatedPaths = [...variation.storage_paths, storagePath];
  } else {
    updatedPaths = [...variation.storage_paths];
    updatedPaths[editIndex] = storagePath;
  }

  await admin
    .from("ai_variations")
    .update({ chat_rounds_used: round, storage_paths: updatedPaths })
    .eq("id", variationId);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[chat-edit] ── DONE ── round ${round}/25, ${isSingle ? "appended" : `replaced page ${editIndex + 1}`}, ${elapsed}s total`);
}

// ─────────────────────────────────────────────────────────────────────
// REEL CHAT EDIT — modifies the Remotion composition code and re-renders
// ─────────────────────────────────────────────────────────────────────

async function runReelChatEdit(
  variation: {
    id: string;
    request_id: string;
    variation_index: number;
    storage_paths: string[];
    poster_type: string;
    chat_rounds_used: number;
    creative_brief: unknown;
  },
  message: string,
  referenceImages: Buffer[] = [],
): Promise<void> {
  const startTime = Date.now();
  const admin = createAdminClient();
  const openai = await getModelClient();
  const requestId = variation.request_id;

  console.log(`[reel-chat] ── START ── variation=${variation.id}, message="${message.slice(0, 80)}"`);

  // Extract composition code and script from creative_brief. Reels come in two
  // flavours: free-form (Codex-written Reel.tsx → _compositionCode) and schema
  // (structured _reelDoc, Tier 2). They edit via different mechanisms below.
  const brief = variation.creative_brief as Record<string, unknown>;
  const compositionCode = (brief._compositionCode as string) ?? "";
  const isSchemaReel = brief._compositionMode === "schema" || !!brief._reelDoc;
  if (!isSchemaReel && !compositionCode) throw new Error("No composition code found in variation brief");

  // Step 1: Get text confirmation of the edit
  const { data: history } = await admin
    .from("ai_chat_messages")
    .select("role, content")
    .eq("variation_id", variation.id)
    .order("created_at", { ascending: true });

  const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: "You are a video reel editing assistant. The user wants changes to their Instagram Reel. Respond briefly confirming what you'll change. Keep it to 1-2 sentences. Note: changes require re-rendering the video (3-5 minutes).",
    },
  ];
  for (const msg of history ?? []) {
    chatMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }
  chatMessages.push({ role: "user", content: message });

  const chatResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: chatMessages,
    max_tokens: 200,
  });
  const assistantText = chatResponse.choices[0]?.message?.content ?? "Re-rendering your reel with the requested changes...";
  console.log(`[reel-chat] Confirmation: "${assistantText}"`);

  const round = variation.chat_rounds_used + 1;
  const reelScript = brief as unknown as import("./agent-creative-reel").ReelScript;

  // Step 2: Reload the exact asset set used at generation (media + brand + music).
  const { data: reqData } = await admin
    .from("requests")
    .select("school_id")
    .eq("id", requestId)
    .single();
  const schoolId = reqData?.school_id ?? "unknown";

  // Download a storage object with retries. Storage downloads use fetch/undici,
  // which throws `terminated` if a (large video) stream is interrupted mid-transfer
  // — that single blip was crashing the whole chat-edit. Retry transient failures;
  // return null on permanent failure so one bad asset doesn't kill the edit.
  const downloadWithRetry = async (bucket: string, storagePath: string, attempts = 3): Promise<Buffer | null> => {
    for (let i = 1; i <= attempts; i++) {
      try {
        const { data, error } = await admin.storage.from(bucket).download(storagePath);
        if (error) throw error;
        if (data) return Buffer.from(await data.arrayBuffer());
        return null; // not found — no point retrying
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[reel-chat] download ${bucket}/${storagePath} attempt ${i}/${attempts} failed: ${msg}`);
        if (i === attempts) return null;
        await new Promise((r) => setTimeout(r, 500 * i));
      }
    }
    return null;
  };

  // Media — from the variation's scenes (originals still live in request-uploads).
  // Dedup by path: the per-scene model reuses one long video across several scenes,
  // so downloading per-scene re-fetched the same large file many times (slow, and
  // more chances for a `terminated` stream error). Fetch each unique file ONCE.
  const scenes = (brief.scenes as Array<{ mediaPath: string; mediaType?: "image" | "video" }>) ?? [];
  const mediaFiles = new Map<string, Buffer>();
  const mediaManifest = new Map<string, { type: "image" | "video"; description: string; orientation?: "landscape" | "portrait" | "square" }>();
  const seenPaths = new Set<string>();
  for (const scene of scenes) {
    if (!scene.mediaPath || seenPaths.has(scene.mediaPath)) continue;
    seenPaths.add(scene.mediaPath);
    const filename = scene.mediaPath.split("/").pop() ?? "media.bin";
    const buf = await downloadWithRetry("request-uploads", scene.mediaPath);
    if (buf) {
      mediaFiles.set(filename, buf);
      mediaManifest.set(filename, {
        type: scene.mediaType === "video" ? "video" : "image",
        description: "uploaded media",
      });
    } else {
      console.warn(`[reel-chat] media ${filename} could not be downloaded — proceeding without it`);
    }
  }

  // Brand assets — logo AND footer (the old code dropped footer → render 404s).
  const { data: brandAssets } = await admin
    .from("school_brand_assets")
    .select("asset_type, storage_path")
    .eq("school_id", schoolId)
    .in("asset_type", ["logo", "footer"]);
  let hasLogo = false;
  let hasFooter = false;
  let logoProfile: import("./logo-analysis").LogoProfile | undefined;
  for (const a of brandAssets ?? []) {
    const buf = await downloadWithRetry("school-assets", a.storage_path);
    if (!buf) continue;
    if (a.asset_type === "logo") {
      mediaFiles.set("logo.png", buf);
      hasLogo = true;
      const { analyzeLogo } = await import("./logo-analysis");
      logoProfile = (await analyzeLogo(buf)) ?? undefined;
    } else if (a.asset_type === "footer") { mediaFiles.set("footer.png", buf); hasFooter = true; }
  }

  // Music — reuse the persisted track so the soundtrack stays identical across
  // edits. Only re-discover when the user explicitly asks to change it.
  let musicPath = brief._musicPath as string | undefined;
  let musicFile: { name: string; buffer: Buffer } | undefined;
  let musicSource = brief._musicSource as string | undefined;
  const musicRe = /\b(music|song|track|audio|sound|tune|soundtrack|bgm|background\s*music)\b/i;
  const mentionsMusic = musicRe.test(message);
  // Scope intent to the CLAUSE that mentions music, so "remove the slide numbering"
  // (a different clause) can't be read as "remove music", and "reduce BGM" reads as
  // ducking (keep) rather than removal. Split on list markers / punctuation.
  const clauses = message.split(/[\n.,;]|\d+\s*[.)]/).map((c) => c.trim()).filter(Boolean);
  const musicClauses = clauses.filter((c) => musicRe.test(c));
  const inMusicClause = (re: RegExp) => musicClauses.some((c) => re.test(c));
  const wantsMusicDuck = inMusicClause(/\b(reduce|lower|quiet|softer|soften|duck|less|turn\s*down|tone\s*down)\b/i);
  const wantsMusicOff = mentionsMusic && !wantsMusicDuck &&
    inMusicClause(/\b(remove|mute|silent|without|no\s+music|turn\s*off|delete|get\s*rid|drop)\b/i);
  const wantsMusicChange = mentionsMusic && !wantsMusicOff && !wantsMusicDuck &&
    inMusicClause(/\b(change|different|new|replace|swap|another|other)\b/i);

  // Tracks whether we ended up with REAL (audible) music, vs none/silence.
  let hasRealMusic = false;
  if (wantsMusicOff) {
    console.log(`[reel-chat] Edit requests music removed`);
    musicPath = undefined;
    musicSource = "none";
  } else if (wantsMusicChange) {
    console.log(`[reel-chat] Edit requests a music change — re-discovering`);
    const { findAndTrimMusic } = await import("./agent-music");
    const music = await findAndTrimMusic({
      musicMood: reelScript.musicMood ?? [],
      musicTempo: reelScript.musicTempo ?? "moderate",
      durationSec: reelScript.durationSec ?? 30,
    });
    if (music.buffer.length > 0 && music.source !== "fallback-silent") {
      musicFile = { name: "track.mp3", buffer: music.buffer };
      musicSource = music.source;
      hasRealMusic = true;
      musicPath = `${schoolId}/${requestId}/ai/${variation.variation_index}/music-r${round}.mp3`;
      await admin.storage.from("designs").upload(musicPath, music.buffer, { contentType: "audio/mpeg", upsert: true });
    }
  } else if (musicPath) {
    const buf = await downloadWithRetry("designs", musicPath);
    if (buf) {
      musicFile = { name: "track.mp3", buffer: buf };
      hasRealMusic = true;
    } else {
      console.warn(`[reel-chat] Persisted track ${musicPath} is no longer available — falling back to silence`);
    }
  }

  // UNIVERSAL 404 SAFETY NET: the composition may still reference
  // staticFile("music/track.mp3") whatever happened above — music turned off,
  // re-discovery failed, OR a persisted track that has since gone missing. Always
  // supply SOMETHING so the render can never 404 on the music file.
  if (!musicFile) {
    const { generateSilentTrack } = await import("./agent-music");
    musicFile = { name: "track.mp3", buffer: await generateSilentTrack(reelScript.durationSec ?? 30) };
    console.log(`[reel-chat] No track available — using silent track (render-safe)`);
  }
  // Tell the editor music exists only when it's REAL — so when we're only supplying
  // a silent safety-net track it removes the Audio element rather than playing silence.
  const hasMusic = hasRealMusic;

  // Step 3+4: Apply the edit and re-render. Two paths by reel flavour; both produce
  // a `renderResult` and the composition-specific creative_brief fields to persist.
  let renderResult: Awaited<ReturnType<typeof import("@/lib/remotion/render")["renderReelDoc"]>>;
  let usedFallback = false;
  let briefComposition: Record<string, unknown>;

  if (isSchemaReel) {
    // SCHEMA reel: mutate the ReelDoc JSON (validated) and render it with the fixed
    // renderer. No code patching, no repair loop needed (the renderer is fixed).
    const { editReelDoc } = await import("./agent-reel-doc");
    const { renderReelDoc } = await import("@/lib/remotion/render");
    const currentDoc = brief._reelDoc as import("./reel-doc").ReelDoc;
    console.log(`[reel-chat] Schema reel — editing ReelDoc (${currentDoc.scenes?.length ?? 0} scenes)`);
    const newDoc = await editReelDoc({ doc: currentDoc, instruction: message, mediaManifest, hasLogo, hasFooter, hasMusic, referenceImages });
    console.log(`[reel-chat] Re-rendering edited ReelDoc (${newDoc.scenes.length} scenes) with ${mediaFiles.size} media files, music=${hasMusic}`);
    renderResult = await renderReelDoc({ doc: newDoc, mediaFiles, musicFile });
    briefComposition = { _reelDoc: newDoc, _compositionMode: "schema" };
    console.log(`[reel-chat] Rendered in ${renderResult.renderTimeSec.toFixed(1)}s`);
  } else {
    // FREE-FORM reel: surgical TSX edit + self-correcting render/repair loop.
    const { editComposition, renderWithRepair } = await import("./agent-composition");
    const edited = await editComposition({
      originalCode: compositionCode,
      instruction: message,
      script: reelScript,
      mediaManifest,
      hasLogo,
      logoProfile,
      hasFooter,
      hasMusic,
      referenceImages,
    });
    console.log(`[reel-chat] Got edited composition: ${edited.reelTsx.length} chars`);
    console.log(`[reel-chat] Re-rendering with ${mediaFiles.size} media files, music=${hasMusic}`);
    const r = await renderWithRepair({
      composition: {
        reelTsx: edited.reelTsx,
        dataTsx: edited.dataTsx ?? (brief._compositionDataCode as string | undefined),
      },
      script: reelScript,
      assets: { mediaFiles, mediaManifest, musicFile, hasLogo, hasFooter, hasMusic },
      label: `edit r${round}`,
    });
    renderResult = r.renderResult;
    usedFallback = r.usedFallback;
    briefComposition = { _compositionCode: r.composition.reelTsx, _compositionDataCode: r.composition.dataTsx };
    console.log(`[reel-chat] Rendered in ${renderResult.renderTimeSec.toFixed(1)}s${usedFallback ? " (fallback slideshow)" : ""}`);
  }

  // Step 5: Upload the new reel, THEN update the variation. The upload MUST be
  // verified before we touch storage_paths: a silently-failed upload here used to
  // overwrite the live pointer with a dead path — blanking the player AND
  // de-referencing the previous render (data loss). Retry transient failures; on a
  // hard failure, throw so the edit is marked failed and the existing reel is left
  // completely intact.
  const timestamp = Date.now();
  const storagePath = `${schoolId}/${requestId}/ai/${variation.variation_index}/edits/${round}-reel-${timestamp}.mp4`;
  const fsPromises = await import("node:fs").then((m) => m.promises);
  const mp4Buffer = await fsPromises.readFile(renderResult.outputPath);

  let uploaded = false;
  let lastUploadErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await admin.storage.from("designs").upload(storagePath, mp4Buffer, {
      contentType: "video/mp4",
      upsert: true,
    });
    if (!error) { uploaded = true; break; }
    lastUploadErr = error.message;
    console.warn(`[reel-chat] upload attempt ${attempt}/3 failed: ${error.message}`);
    await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  if (!uploaded) {
    await renderResult.cleanup();
    // storage_paths is deliberately NOT updated — the existing reel stays live.
    throw new Error(`Edit rendered but upload failed after 3 attempts (existing reel left intact): ${lastUploadErr}`);
  }
  console.log(`[reel-chat] Uploaded edit: ${storagePath} (${(mp4Buffer.length / 1024 / 1024).toFixed(1)} MB)`);

  await admin.from("ai_chat_messages").insert({
    variation_id: variation.id,
    role: "assistant",
    content: assistantText,
    image_paths: [storagePath],
    metadata: { model: isSchemaReel ? "codex-reeldoc" : "codex-composition", round, usedFallback },
  });

  await admin
    .from("ai_variations")
    .update({
      chat_rounds_used: round,
      storage_paths: [storagePath],
      creative_brief: {
        ...brief,
        ...briefComposition,
        _musicPath: musicPath,
        _musicSource: musicSource,
      } as unknown as Record<string, unknown>,
    })
    .eq("id", variation.id);

  await renderResult.cleanup();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[reel-chat] ── DONE ── round ${round}/25, ${elapsed}s total`);
}
