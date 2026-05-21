"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import type {
  CalendarItemStatus,
  UserRole,
} from "@/lib/supabase/types";

export type CalendarItemCreateState = {
  error?: string;
  itemId?: string;
};

type CalendarItemRow = {
  id: string;
  school_id: string;
  created_by: string;
  linked_request_id: string | null;
  planned_date: string;
  title: string;
  description: string | null;
  status: CalendarItemStatus;
};

type Actor = {
  userId: string;
  role: UserRole;
};

async function loadActor(): Promise<Actor | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (error || !profile) return { error: "Profile not found." };
  return { userId: user.id, role: profile.role };
}

async function loadItem(
  id: string,
): Promise<CalendarItemRow | { error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_items")
    .select(
      "id, school_id, created_by, linked_request_id, planned_date, title, description, status",
    )
    .eq("id", id)
    .single<CalendarItemRow>();
  if (error || !data) return { error: "Calendar item not found." };
  return data;
}

function isYYYYMMDD(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function createCalendarItem(
  _prev: CalendarItemCreateState,
  formData: FormData,
): Promise<CalendarItemCreateState> {
  const schoolId = String(formData.get("school_id") ?? "");
  const plannedDate = String(formData.get("planned_date") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!schoolId) return { error: "Pick a school." };
  if (!isYYYYMMDD(plannedDate)) return { error: "Pick a valid date." };
  if (!title) return { error: "Give the item a short title." };

  const actor = await loadActor();
  if ("error" in actor) return { error: actor.error };
  if (actor.role !== "designer" && actor.role !== "super_admin") {
    return { error: "Only designers plan calendar items." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_items")
    .insert({
      school_id: schoolId,
      created_by: actor.userId,
      planned_date: plannedDate,
      title,
      description: description || null,
      status: "drafted",
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return { error: error?.message ?? "Could not save." };

  revalidatePath("/calendar");
  return { itemId: data.id };
}

export async function updateCalendarItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const plannedDate = String(formData.get("planned_date") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!id) throw new Error("Missing id.");
  if (!isYYYYMMDD(plannedDate)) throw new Error("Pick a valid date.");
  if (!title) throw new Error("Title is required.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (
    actor.role !== "designer" &&
    actor.role !== "school_admin" &&
    actor.role !== "super_admin"
  ) {
    throw new Error("Your role can't edit calendar items.");
  }

  const item = await loadItem(id);
  if ("error" in item) throw new Error(item.error);
  if (item.status !== "drafted" && actor.role !== "super_admin") {
    throw new Error("Approved items are locked. Cancel and re-plan instead.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_items")
    .update({
      planned_date: plannedDate,
      title,
      description: description || null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/calendar/${id}`);
  revalidatePath("/calendar");
  redirect(`/calendar/${id}`);
}

export async function approveCalendarItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (actor.role !== "school_admin" && actor.role !== "super_admin") {
    throw new Error("Only a school admin can approve calendar items.");
  }

  const item = await loadItem(id);
  if ("error" in item) throw new Error(item.error);
  if (item.status !== "drafted") {
    throw new Error("Only drafted items can be approved.");
  }

  const supabase = await createClient();

  const { data: newRequest, error: insertErr } = await supabase
    .from("requests")
    .insert({
      school_id: item.school_id,
      created_by: actor.userId,
      title: item.title,
      description: item.description,
      status: "approved",
      approved_by: actor.userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (insertErr || !newRequest) {
    throw new Error(insertErr?.message ?? "Could not create request.");
  }

  const { error: updateErr } = await supabase
    .from("calendar_items")
    .update({
      status: "admin_approved",
      linked_request_id: newRequest.id,
    })
    .eq("id", id);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath(`/calendar/${id}`);
  revalidatePath("/calendar");
  revalidatePath("/requests");
  await dispatchPendingPushes();
}

export async function cancelCalendarItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");

  const actor = await loadActor();
  if ("error" in actor) throw new Error(actor.error);
  if (
    actor.role !== "designer" &&
    actor.role !== "school_admin" &&
    actor.role !== "super_admin"
  ) {
    throw new Error("Your role can't cancel calendar items.");
  }

  const item = await loadItem(id);
  if ("error" in item) throw new Error(item.error);
  if (item.status === "fulfilled" || item.status === "cancelled") {
    throw new Error("Already closed.");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_items")
    .update({ status: "cancelled" })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/calendar/${id}`);
  revalidatePath("/calendar");
}
