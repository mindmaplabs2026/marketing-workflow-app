"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type MemberActionState = { error?: string; success?: boolean };

export async function addMember(
  schoolId: string,
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "Pick a user to add." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_members")
    .insert({ school_id: schoolId, user_id: userId });

  if (error) {
    if (error.code === "23505") {
      return { error: "That user is already a member of this school." };
    }
    return { error: error.message };
  }

  revalidatePath(`/admin/schools/${schoolId}`);
  return { success: true };
}

export async function removeMember(formData: FormData) {
  const memberId = String(formData.get("member_id") ?? "");
  const schoolId = String(formData.get("school_id") ?? "");
  if (!memberId || !schoolId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_members")
    .delete()
    .eq("id", memberId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/schools/${schoolId}`);
}
