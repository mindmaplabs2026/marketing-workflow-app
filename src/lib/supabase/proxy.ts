import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/login/team",
  "/auth/callback",
  "/auth/native-callback",
];
const SETUP_PASSWORD_PATH = "/setup-password";

function isPublicPath(pathname: string): boolean {
  // API routes do their own auth (Bearer secret, or via createClient() inside
  // the handler) and should never be redirected to /login — programmatic
  // callers expect 401 JSON, not a 307 to an HTML page.
  if (pathname.startsWith("/api/")) return true;
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(request: NextRequest) {
  // Mirror the pathname into a request header so the root layout can
  // decide whether to render the AppShell. Server Components can't see
  // the URL directly, but headers() can.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Skip auth refresh until Supabase env is configured.
  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = NextResponse.next({
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  const { pathname } = request.nextUrl;
  const publicPath = isPublicPath(pathname);
  const onSetupPath = pathname === SETUP_PASSWORD_PATH;

  // Public paths never need auth — skip the Supabase round-trip
  // entirely. Cuts ~200ms off every /login, /auth/* and /api/* nav.
  if (publicPath) return supabaseResponse;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" || pathname === "/login/team") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Invited internal users land here right after redeeming their invite
  // link. Force them through /setup-password before they can do anything
  // else; the setPassword action flips password_set=true and lets them out.
  if (!onSetupPath) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("password_set")
      .eq("id", user.id)
      .single();
    if (profile && profile.password_set === false) {
      const url = request.nextUrl.clone();
      url.pathname = SETUP_PASSWORD_PATH;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
