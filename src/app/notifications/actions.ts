"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { NotificationEmailPref } from "@/lib/supabase/types";

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
