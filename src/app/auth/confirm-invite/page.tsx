import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { ConfirmInviteForm } from "./confirm-form";

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

type SearchParams = {
  token_hash?: string;
  type?: string;
  next?: string;
};

export default async function ConfirmInvitePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tokenHash = params.token_hash ?? "";
  const type = params.type ?? "";
  const next = params.next ?? "/";

  if (!tokenHash || !type || !isOtpType(type)) {
    redirect("/login?error=missing_code");
  }

  // If the caller is already signed in (e.g. they clicked the link a second
  // time after redeeming it once), skip the confirm step entirely.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect(next);
  }

  return <ConfirmInviteForm tokenHash={tokenHash} type={type} next={next} />;
}
