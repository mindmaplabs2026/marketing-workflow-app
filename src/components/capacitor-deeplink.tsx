"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

// appUrlOpen and getLaunchUrl can both deliver the same URL on a
// cold-started intent. Running exchangeCodeForSession twice burns the
// PKCE verifier on the first call and the second one fails noisily.
const handledUrls = new Set<string>();

function handleDeepLink(url: string) {
  if (handledUrls.has(url)) return;
  handledUrls.add(url);

  try {
    // Magic-link callback over our custom scheme. PKCE verifier lives
    // in the WebView's storage, so we exchange the code on the client
    // at /auth/native-callback rather than the server /auth/callback
    // route used by web browsers.
    if (url.startsWith("com.mindmaplabs.workflow://")) {
      const incoming = new URL(url);
      window.location.href = `/auth/native-callback${incoming.search}`;
      return;
    }

    const incoming = new URL(url);
    const path = incoming.pathname + incoming.search + incoming.hash;
    if (path && path !== "/") {
      window.location.href = path;
    }
  } catch {
    // Ignore malformed URLs
  }
}

export function CapacitorDeepLink() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Capacitor?.isNativePlatform?.()) return;

    let cleanup: (() => void) | undefined;

    import("@capacitor/app").then(({ App }) => {
      // URLs received while the app is already running.
      App.addListener("appUrlOpen", (event) => {
        handleDeepLink(event.url);
      }).then((handle) => {
        cleanup = () => handle.remove();
      });

      // URL that cold-started the app via an intent. addListener does
      // not fire in that case — we have to ask for the launch URL.
      App.getLaunchUrl().then((result) => {
        if (result?.url) handleDeepLink(result.url);
      });
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
