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

// ---------------------------------------------------------------
// Brand asset actions
// ---------------------------------------------------------------

export async function attachBrandAsset(formData: FormData) {
  const schoolId = String(formData.get("school_id") ?? "");
  const assetType = String(formData.get("asset_type") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  const mimeType = String(formData.get("mime_type") ?? "") || null;
  const fileSize = Number(formData.get("file_size") ?? 0) || null;
  const label = String(formData.get("label") ?? "").trim() || null;

  if (!schoolId || !assetType || !storagePath) {
    return { error: "Missing required fields." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { error } = await supabase.from("school_brand_assets").insert({
    school_id: schoolId,
    asset_type: assetType as import("@/lib/supabase/types").BrandAssetType,
    storage_path: storagePath,
    mime_type: mimeType,
    file_size: fileSize,
    label,
    uploaded_by: user.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/schools/${schoolId}/brand-assets`);
}

export async function removeBrandAsset(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const schoolId = String(formData.get("school_id") ?? "");
  const storagePath = String(formData.get("storage_path") ?? "");
  if (!assetId || !schoolId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("school_brand_assets")
    .delete()
    .eq("id", assetId);
  if (error) throw new Error(error.message);

  if (storagePath) {
    await supabase.storage.from("school-assets").remove([storagePath]);
  }

  revalidatePath(`/admin/schools/${schoolId}/brand-assets`);
}
