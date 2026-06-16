import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "sonner";
import { CapacitorNative } from "@/components/capacitor-native";
import { RefreshOnFocus } from "@/components/refresh-on-focus";
import { AppShell } from "@/components/app-shell";

const SHELL_FREE_PREFIXES = ["/login", "/change-password"];

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
      <body className="min-h-full flex flex-col">
        <CapacitorNative />
        <RefreshOnFocus />
        {shellFree ? children : <AppShell>{children}</AppShell>}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          expand
          duration={4000}
          // On phones the bottom nav (~4rem) sits at the bottom, so lift the
          // toast above it (plus the device safe-area) and give side padding so
          // it reads as a full-width card.
          mobileOffset={{
            bottom: "calc(4.5rem + env(safe-area-inset-bottom))",
            left: "12px",
            right: "12px",
          }}
        />
      </body>
    </html>
  );
}
