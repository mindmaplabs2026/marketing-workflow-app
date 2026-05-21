"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type {
  NotificationEmailPref,
  NotificationType,
  RequestStatus,
  UserRole,
} from "@/lib/supabase/types";

export async function openNotification(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing notification id.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // Mark read, then resolve the target row in one round-trip.
  const { data: row } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("recipient_id", user.id)
    .select("request_id, calendar_item_id")
    .single<{ request_id: string | null; calendar_item_id: string | null }>();

  revalidatePath("/notifications");

  const target = row?.request_id
    ? `/requests/${row.request_id}`
    : row?.calendar_item_id
      ? `/calendar/${row.calendar_item_id}`
      : "/notifications";
  redirect(target);
}

export async function markAllRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
}

export type PushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export async function subscribePush(payload: PushSubscriptionPayload) {
  if (!payload?.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    throw new Error("Invalid push subscription payload.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  // Upsert by endpoint so re-enabling on the same browser refreshes keys
  // and last_seen_at rather than creating duplicates.
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        user_agent: payload.userAgent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
}

const VALID_PREFS: ReadonlyArray<NotificationEmailPref> = [
  "off",
  "daily",
  "immediate",
];

type BatchChoice = "approve" | "send_back";

type ApprovableType =
  | "request_submitted_for_approval"
  | "design_uploaded_for_review";

const APPROVABLE_TYPES: ReadonlySet<NotificationType> = new Set([
  "request_submitted_for_approval",
  "design_uploaded_for_review",
] satisfies ApprovableType[]);

export async function batchAct(formData: FormData) {
  const choice = String(formData.get("action") ?? "") as BatchChoice;
  if (choice !== "approve" && choice !== "send_back") {
    throw new Error("Invalid action.");
  }
  const ids = formData.getAll("notification_id").map(String).filter(Boolean);
  if (ids.length === 0) {
    revalidatePath("/notifications");
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (profile?.role !== "school_admin" && profile?.role !== "super_admin") {
    throw new Error("Only a school admin can do that.");
  }

  const { data: notifs } = await supabase
    .from("notifications")
    .select("id, type, request_id")
    .in("id", ids)
    .eq("recipient_id", user.id)
    .returns<
      { id: string; type: NotificationType; request_id: string | null }[]
    >();

  const targets = (notifs ?? []).filter(
    (n) => n.request_id && APPROVABLE_TYPES.has(n.type),
  );
  if (targets.length === 0) {
    revalidatePath("/notifications");
    return;
  }

  // Look up current statuses in bulk so we can skip ones that already moved.
  const requestIds = Array.from(new Set(targets.map((n) => n.request_id!)));
  const { data: reqs } = await supabase
    .from("requests")
    .select("id, status")
    .in("id", requestIds)
    .returns<{ id: string; status: RequestStatus }[]>();
  const statusById = new Map((reqs ?? []).map((r) => [r.id, r.status]));

  // Group by (current status, transition) so each update is one query.
  const toApprove: string[] = [];
  const toSendBack: string[] = [];
  const toApproveDesign: string[] = [];
  const toRequestChanges: string[] = [];

  for (const n of targets) {
    const status = statusById.get(n.request_id!);
    if (!status) continue;
    if (n.type === "request_submitted_for_approval") {
      if (status !== "pending_admin_approval") continue;
      if (choice === "approve") toApprove.push(n.request_id!);
      else toSendBack.push(n.request_id!);
    } else if (n.type === "design_uploaded_for_review") {
      if (status !== "design_pending_approval") continue;
      if (choice === "approve") toApproveDesign.push(n.request_id!);
      else toRequestChanges.push(n.request_id!);
    }
  }

  if (toApprove.length > 0) {
    await supabase
      .from("requests")
      .update({ status: "approved", approved_by: user.id })
      .in("id", toApprove);
  }
  if (toSendBack.length > 0) {
    await supabase.from("requests").update({ status: "draft" }).in("id", toSendBack);
  }
  if (toApproveDesign.length > 0) {
    await supabase
      .from("requests")
      .update({ status: "in_design" })
      .in("id", toApproveDesign);
  }
  if (toRequestChanges.length > 0) {
    await supabase
      .from("requests")
      .update({ status: "changes_requested" })
      .in("id", toRequestChanges);
  }

  // Mark each acted-on notification read so the bell badge clears.
  const actedNotifIds = targets
    .filter((n) => {
      const s = statusById.get(n.request_id!);
      if (!s) return false;
      if (n.type === "request_submitted_for_approval")
        return s === "pending_admin_approval";
      if (n.type === "design_uploaded_for_review")
        return s === "design_pending_approval";
      return false;
    })
    .map((n) => n.id);

  if (actedNotifIds.length > 0) {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", actedNotifIds);
  }

  await dispatchPendingPushes();
  revalidatePath("/notifications");
  revalidatePath("/requests");
}

export async function setEmailPref(formData: FormData) {
  const raw = String(formData.get("pref") ?? "");
  if (!(VALID_PREFS as readonly string[]).includes(raw)) {
    throw new Error("Invalid preference.");
  }
  const pref = raw as NotificationEmailPref;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("profiles")
    .update({ email_pref: pref })
    .eq("id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
}

export async function unsubscribePush(endpoint: string) {
  if (!endpoint) throw new Error("Missing endpoint.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) throw new Error(error.message);

  revalidatePath("/notifications");
}
