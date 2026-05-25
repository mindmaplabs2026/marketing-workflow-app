import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Native (Capacitor) auth runs the PKCE exchange in the WebView. The
// session it gets back must be written into the server's cookie jar via
// Set-Cookie so subsequent SSR requests see the user. Without this
// round-trip the WebView holds the session in document.cookie/LS but
// the next SSR render of the home page can't see it, and AppShell
// renders with no chrome.
export async function POST(request: NextRequest) {
  const { access_token, refresh_token } = (await request.json()) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "missing_tokens" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
