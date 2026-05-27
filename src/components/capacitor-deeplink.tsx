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
// In-memory dedup handles repeat fires within one JS lifetime; the
// sessionStorage mirror survives the navigation we trigger below, so
// the post-nav page load doesn't re-handle the launch URL a third time.
const SESSION_KEY = "mw_handled_deeplinks";
// A separate flag signals "we are mid-navigation to a deep-link target,"
// so the destination page can keep the splash up until it's ready instead
// of briefly showing /login or whatever the proxy redirected the cold
// WebView to.
const PENDING_KEY = "mw_deep_link_pending";
const handledUrls = new Set<string>();

function loadHandled() {
  if (typeof window === "undefined") return;
  if (handledUrls.size > 0) return;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    for (const u of JSON.parse(raw) as string[]) handledUrls.add(u);
  } catch {
    // sessionStorage may be unavailable; in-memory dedup still works.
  }
}

function persistHandled() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(Array.from(handledUrls)),
    );
  } catch {
    // sessionStorage may be unavailable; in-memory dedup still works.
  }
}

function handleDeepLink(url: string): boolean {
  loadHandled();
  if (handledUrls.has(url)) return false;
  handledUrls.add(url);
  persistHandled();

  try {
    // Magic-link callback over our custom scheme. PKCE verifier lives
    // in the WebView's storage, so we exchange the code on the client
    // at /auth/native-callback rather than the server /auth/callback
    // route used by web browsers.
    if (url.startsWith("com.mindmaplabs.workflow://")) {
      const incoming = new URL(url);
      window.location.href = `/auth/native-callback${incoming.search}`;
      return true;
    }

    const incoming = new URL(url);
    const path = incoming.pathname + incoming.search + incoming.hash;
    if (path && path !== "/") {
      window.location.href = path;
      return true;
    }
  } catch {
    // Ignore malformed URLs
  }
  return false;
}

function removeInlineSplash() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("__cap_splash");
  if (el) el.remove();
}

function ensureInlineSplash() {
  if (typeof document === "undefined") return;
  if (document.getElementById("__cap_splash")) return;
  const dark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const s = document.createElement("div");
  s.id = "__cap_splash";
  s.setAttribute("aria-hidden", "true");
  s.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:${
    dark ? "#09090b" : "#fafafa"
  };`;
  document.body.appendChild(s);
}

export function CapacitorDeepLink() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Capacitor?.isNativePlatform?.()) {
      // Inline script only injects on native, but if anything snuck
      // through (e.g. a dev override) make sure web users don't sit
      // behind a phantom splash.
      removeInlineSplash();
      return;
    }

    loadHandled();

    // If we are mid-flight between pages because a deep-link navigation
    // is in progress, the destination page's inline splash should stay
    // up until we settle here.
    const pending =
      window.sessionStorage.getItem(PENDING_KEY) === "1";
    if (pending) {
      ensureInlineSplash();
    }

    let cleanup: (() => void) | undefined;
    let safetyTimer: ReturnType<typeof setTimeout> | undefined;

    function settle() {
      try {
        window.sessionStorage.removeItem(PENDING_KEY);
      } catch {
        // ignore
      }
      removeInlineSplash();
    }

    import("@capacitor/app").then(({ App }) => {
      // URLs received while the app is already running.
      App.addListener("appUrlOpen", (event) => {
        if (!handledUrls.has(event.url)) {
          try {
            window.sessionStorage.setItem(PENDING_KEY, "1");
          } catch {
            // ignore
          }
          ensureInlineSplash();
        }
        handleDeepLink(event.url);
      }).then((handle) => {
        cleanup = () => handle.remove();
      });

      // URL that cold-started the app via an intent. addListener does
      // not fire in that case — we have to ask for the launch URL.
      App.getLaunchUrl().then((result) => {
        if (result?.url) {
          if (!handledUrls.has(result.url)) {
            try {
              window.sessionStorage.setItem(PENDING_KEY, "1");
            } catch {
              // ignore
            }
            ensureInlineSplash();
            handleDeepLink(result.url);
            // Navigation will tear down this React tree; the destination
            // page's inline splash carries the visual until settle().
          } else {
            settle();
          }
        } else {
          settle();
        }
      });

      // Safety: never get stuck behind the splash forever.
      safetyTimer = setTimeout(settle, 4000);
    });

    return () => {
      cleanup?.();
      if (safetyTimer) clearTimeout(safetyTimer);
    };
  }, []);

  return null;
}
