"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

export function CapacitorDeepLink() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Capacitor?.isNativePlatform?.()) return;

    let cleanup: (() => void) | undefined;

    import("@capacitor/app").then(({ App }) => {
      App.addListener("appUrlOpen", (event) => {
        try {
          // Magic-link callback over our custom scheme. PKCE verifier
          // lives in the WebView's storage, so we exchange the code on
          // the client at /auth/native-callback rather than the server
          // /auth/callback route used by web browsers.
          if (event.url.startsWith("com.mindmaplabs.workflow://")) {
            const incoming = new URL(event.url);
            window.location.href = `/auth/native-callback${incoming.search}`;
            return;
          }

          const incoming = new URL(event.url);
          const path = incoming.pathname + incoming.search + incoming.hash;
          if (path && path !== "/") {
            window.location.href = path;
          }
        } catch {
          // Ignore malformed URLs
        }
      }).then((handle) => {
        cleanup = () => handle.remove();
      });
    });

    return () => {
      cleanup?.();
    };
  }, []);

  return null;
}
