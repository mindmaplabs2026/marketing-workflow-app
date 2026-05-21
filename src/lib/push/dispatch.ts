import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
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
  }
}

// Drains all pending notifications across all users, pushes them, and marks
// pushed_at. Safe to call repeatedly — does nothing when queue is empty.
// Failures on individual sends don't block siblings; gone subscriptions are
// pruned automatically.
export async function dispatchPendingPushes(): Promise<void> {
  const skip = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? false : true;
  if (skip) return;

  try {
    configure();
  } catch (e) {
    console.warn("push dispatch skipped:", e instanceof Error ? e.message : e);
    return;
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
  const dispatchedIds: string[] = [];

  await Promise.all(
    Array.from(byRecipient.entries()).map(async ([userId, rows]) => {
      const { data: subs } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", userId)
        .returns<SubRow[]>();

      // No active devices — still mark as dispatched so we don't retry forever.
      if (!subs || subs.length === 0) {
        for (const r of rows) dispatchedIds.push(r.id);
        return;
      }

      for (const row of rows) {
        const payload = JSON.stringify({
          title: titleFor(row.type),
          body: row.body,
          url: deepLinkFor(row),
          tag: row.request_id ?? row.calendar_item_id ?? row.id,
        });

        await Promise.all(
          subs.map(async (sub) => {
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
                typeof (err as { statusCode?: number }).statusCode === "number"
                  ? (err as { statusCode: number }).statusCode
                  : 0;
              if (status === 404 || status === 410) {
                goneSubscriptionIds.push(sub.id);
              } else {
                console.error("push send failed", status, err);
              }
            }
          }),
        );

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
}
