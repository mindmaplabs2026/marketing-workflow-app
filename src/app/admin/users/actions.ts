"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";

const VALID_ROLES: UserRole[] = [
  "super_admin",
  "designer",
  "school_admin",
  "teacher",
  "decision_maker",
];

export async function updateUserRole(formData: FormData) {
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!userId || !VALID_ROLES.includes(role)) {
    throw new Error("Invalid input.");
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    throw new Error(
      "You can't change your own role here. Use SQL if you really mean to.",
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/users");
}
