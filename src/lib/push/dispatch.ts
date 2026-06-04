import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchImmediateEmails } from "@/lib/email/dispatch";
import { sendFcm } from "@/lib/push/fcm";
import type { NotificationType } from "@/lib/supabase/types";

// Configure web-push once per process. Throws at call-time if env is missing.
let configured = false;
function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "VAPID env vars missing. Run `node scripts/generate-vapid.mjs` and paste the output into .env.local.",
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

type PendingRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  body: string;
  request_id: string | null;
  calendar_item_id: string | null;
};

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type FcmTokenRow = {
  id: string;
  token: string;
};

function deepLinkFor(row: PendingRow): string {
  if (row.request_id) return `/requests/${row.request_id}`;
  if (row.calendar_item_id) return `/calendar/${row.calendar_item_id}`;
  return "/notifications";
}

function titleFor(type: NotificationType): string {
  switch (type) {
    case "request_submitted_for_approval":
      return "New request needs approval";
    case "request_approved":
      return "New request to design";
    case "request_sent_back_to_draft":
      return "Draft sent back";
    case "design_uploaded_for_review":
      return "Design ready to review";
    case "design_approved":
      return "Design approved";
    case "design_changes_requested":
      return "Changes requested";
    case "request_published":
      return "Published";
    case "calendar_item_approved":
      return "Calendar item approved";
    case "user_added_to_school":
      return "Added to a school";
    case "ai_generation_completed":
      return "AI posters ready";
    case "ai_generation_failed":
      return "AI generation failed";
  }
}

// Inline approve / send-back buttons on the OS notification banner.
// Only meaningful for the two types that target a school_admin reviewer.
// Chrome/Edge render these; Safari/iOS ignore them gracefully.
function actionsFor(
  type: NotificationType,
): Array<{ action: string; title: string }> | undefined {
  if (type === "request_submitted_for_approval") {
    return [
      { action: "approve_request", title: "Approve" },
      { action: "send_back_request", title: "Send back" },
    ];
  }
  if (type === "design_uploaded_for_review") {
    return [
      { action: "approve_design", title: "Approve" },
      { action: "request_design_changes", title: "Request changes" },
    ];
  }
  return undefined;
}

// Drains all pending notifications across all users, pushes them, and marks
// pushed_at. Safe to call repeatedly — does nothing when queue is empty.
// Failures on individual sends don't block siblings; gone subscriptions are
// pruned automatically.
export async function dispatchPendingPushes(): Promise<void> {
  // Email dispatch is independent of push, so run it in parallel — both
  // are best-effort and either can fail without blocking the other.
  const emailWork = dispatchImmediateEmails();

  const webPushEnabled = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  const fcmEnabled = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  // Nothing configured — leave notifications un-dispatched so they'll go
  // out once env vars land. Email handles the safety net.
  if (!webPushEnabled && !fcmEnabled) {
    await emailWork;
    return;
  }

  if (webPushEnabled) {
    try {
      configure();
    } catch (e) {
      console.warn(
        "web-push dispatch skipped:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  const admin = createAdminClient();

  const { data: pending, error } = await admin
    .from("notifications")
    .select("id, recipient_id, type, body, request_id, calendar_item_id")
    .is("pushed_at", null)
    .order("created_at", { ascending: true })
    .limit(50)
    .returns<PendingRow[]>();
  if (error) {
    console.error("dispatchPendingPushes: query failed", error);
    return;
  }
  if (!pending || pending.length === 0) return;

  // Group rows by recipient to batch the subscription lookup.
  const byRecipient = new Map<string, PendingRow[]>();
  for (const row of pending) {
    const list = byRecipient.get(row.recipient_id) ?? [];
    list.push(row);
    byRecipient.set(row.recipient_id, list);
  }

  const goneSubscriptionIds: string[] = [];
  const goneFcmTokens: string[] = [];
  const dispatchedIds: string[] = [];

  await Promise.all(
    Array.from(byRecipient.entries()).map(async ([userId, rows]) => {
      // Fetch both channels in parallel — a user may have web push
      // (browser) and FCM (.apk) registered simultaneously, e.g. signed
      // in on both laptop and phone. We send to all.
      const [subsRes, fcmRes] = await Promise.all([
        webPushEnabled
          ? admin
              .from("push_subscriptions")
              .select("id, endpoint, p256dh, auth")
              .eq("user_id", userId)
              .returns<SubRow[]>()
          : Promise.resolve({ data: null as SubRow[] | null }),
        fcmEnabled
          ? admin
              .from("fcm_tokens")
              .select("id, token")
              .eq("user_id", userId)
              .returns<FcmTokenRow[]>()
          : Promise.resolve({ data: null as FcmTokenRow[] | null }),
      ]);
      const subs = subsRes.data ?? [];
      const fcmTokens = fcmRes.data ?? [];

      // No active devices on either channel — still mark as dispatched
      // so we don't retry forever.
      if (subs.length === 0 && fcmTokens.length === 0) {
        for (const r of rows) dispatchedIds.push(r.id);
        return;
      }

      for (const row of rows) {
        const title = titleFor(row.type);
        const deepLink = deepLinkFor(row);
        const tag = row.request_id ?? row.calendar_item_id ?? row.id;

        // Web Push channel
        const webPushWork =
          subs.length > 0
            ? Promise.all(
                subs.map(async (sub) => {
                  const payload = JSON.stringify({
                    title,
                    body: row.body,
                    url: deepLink,
                    tag,
                    actions: actionsFor(row.type),
                    request_id: row.request_id,
                  });
                  try {
                    await webpush.sendNotification(
                      {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth },
                      },
                      payload,
                    );
                  } catch (err: unknown) {
                    const status =
                      typeof err === "object" &&
                      err !== null &&
                      "statusCode" in err &&
                      typeof (err as { statusCode?: number }).statusCode ===
                        "number"
                        ? (err as { statusCode: number }).statusCode
                        : 0;
                    if (status === 404 || status === 410) {
                      goneSubscriptionIds.push(sub.id);
                    } else {
                      console.error("push send failed", status, err);
                    }
                  }
                }),
              )
            : Promise.resolve();

        // FCM channel (native .apk)
        const fcmWork =
          fcmTokens.length > 0
            ? sendFcm({
                tokens: fcmTokens.map((t) => t.token),
                title,
                body: row.body,
                deepLink,
              }).then((res) => {
                if (res.invalidTokens.length > 0) {
                  for (const dead of res.invalidTokens) {
                    const match = fcmTokens.find((t) => t.token === dead);
                    if (match) goneFcmTokens.push(match.id);
                  }
                }
              })
            : Promise.resolve();

        await Promise.all([webPushWork, fcmWork]);
        dispatchedIds.push(row.id);
      }
    }),
  );

  if (dispatchedIds.length > 0) {
    await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", dispatchedIds);
  }
  if (goneSubscriptionIds.length > 0) {
    await admin
      .from("push_subscriptions")
      .delete()
      .in("id", goneSubscriptionIds);
  }
  if (goneFcmTokens.length > 0) {
    await admin.from("fcm_tokens").delete().in("id", goneFcmTokens);
  }

  await emailWork;
}
