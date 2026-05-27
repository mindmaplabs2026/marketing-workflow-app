"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const VALID_TYPES: EmailOtpType[] = [
  "invite",
  "magiclink",
  "signup",
  "recovery",
  "email_change",
  "email",
];

function isOtpType(v: string): v is EmailOtpType {
  return (VALID_TYPES as readonly string[]).includes(v);
}

function safeNext(next: string): string {
  // Only allow same-origin redirects.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function confirmInvite(formData: FormData): Promise<void> {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));

  if (!tokenHash || !type || !isOtpType(type)) {
    redirect("/login?error=missing_code");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });

  if (error) {
    // Token spent. If the user already has a session from a prior redemption,
    // let them through anyway — the destination page can decide what to show.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect(next);
    }
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(next);
}
