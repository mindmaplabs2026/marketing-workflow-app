import { NextResponse } from "next/server";
import { dispatchDailyDigest } from "@/lib/email/dispatch";

// GET (Vercel Cron) or POST (manual) /api/email/digest
//   Auth: Authorization: Bearer ${CRON_SECRET}
// Vercel Cron automatically injects the header when CRON_SECRET is set
// in project env. For manual testing:
//   curl -X POST -H "Authorization: Bearer <secret>" http://localhost:3000/api/email/digest
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this server." },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sent = await dispatchDailyDigest();
    return NextResponse.json({ ok: true, emails_sent: sent });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export { handle as GET, handle as POST };
