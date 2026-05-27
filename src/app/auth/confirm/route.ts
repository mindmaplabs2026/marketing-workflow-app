import { NextResponse, type NextRequest } from "next/server";
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

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  if (!token_hash || !type || !isOtpType(type)) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();

  // Check for an existing session first. The OTP is single-use, and calling
  // verifyOtp on a spent token may invalidate or fail to refresh the session
  // cookie — which would defeat the "second click" fallback. If the caller
  // already has a valid session (i.e. they clicked the link before and we
  // already redeemed the token), just route them. No verifyOtp needed.
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();
  if (existingUser) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  const { error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
