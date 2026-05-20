"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; success?: boolean };

export async function createSchool(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "School name is required." };

  const supabase = await createClient();
  const { error } = await supabase.from("schools").insert({ name });

  if (error) return { error: error.message };

  revalidatePath("/admin/schools");
  revalidatePath("/admin");
  return { success: true };
}

export async function deleteSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("schools").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/schools");
  revalidatePath("/admin");
  redirect("/admin/schools");
}

export async function renameSchool(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("schools")
    .update({ name })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/schools/${id}`);
  revalidatePath("/admin/schools");
}
