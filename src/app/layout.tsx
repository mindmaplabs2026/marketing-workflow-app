import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { CapacitorDeepLink } from "@/components/capacitor-deeplink";
import { CapacitorNative } from "@/components/capacitor-native";
import { AppShell } from "@/components/app-shell";

const SHELL_FREE_PREFIXES = [
  "/login",
  "/auth/callback",
  "/auth/native-callback",
  "/setup-password",
];

function isShellFree(pathname: string): boolean {
  return SHELL_FREE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Marketing Workflow App",
  description:
    "One tracked pipeline for school clients and the design team — replacing WhatsApp chaos.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "/";
  const shellFree = isShellFree(pathname);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Cover the page from first paint until the deep-link handler has
          had a chance to run. The Capacitor WebView cold-starts at /, the
          proxy redirects no-session traffic to /login, and /login would
          otherwise flash before our React deep-link handler navigates to
          /auth/confirm. This runs in <head>, before <body> paints, so the
          flash is gone for real instead of just covered after hydration.
          The CapacitorDeepLink component removes the splash once it has
          decided whether to navigate.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=window.Capacitor;if(!c||!c.isNativePlatform||!c.isNativePlatform())return;var s=document.createElement('div');s.id='__cap_splash';s.setAttribute('aria-hidden','true');var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;s.style.cssText='position:fixed;inset:0;z-index:2147483647;background:'+(dark?'#09090b':'#fafafa')+';';function a(){if(document.body){document.body.appendChild(s);}else{requestAnimationFrame(a);}}a();}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <CapacitorDeepLink />
        <CapacitorNative />
        {shellFree ? children : <AppShell>{children}</AppShell>}
      </body>
    </html>
  );
}
