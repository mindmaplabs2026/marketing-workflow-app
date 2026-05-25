"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

export function CapacitorNative() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.Capacitor?.isNativePlatform?.()) return;

    let backHandle: { remove: () => void } | undefined;

    (async () => {
      // Status bar: stop overlaying the WebView and paint it to match
      // the app's themeColor. Without this the sticky header renders
      // *under* the Android clock/battery icons.
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Light });
        await StatusBar.setBackgroundColor({ color: "#18181b" });
      } catch {
        // Plugin missing on web build — ignore.
      }

      // Splash: hide once we're mounted so we don't sit on a white
      // flash longer than necessary.
      try {
        const { SplashScreen } = await import("@capacitor/splash-screen");
        await SplashScreen.hide();
      } catch {
        // Plugin missing — ignore.
      }

      // Hardware back button: walk WebView history, exit at root. The
      // default Capacitor behavior is to do nothing at the root, which
      // makes the app feel broken compared to other Android apps.
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("backButton", () => {
          if (window.history.length > 1 && window.location.pathname !== "/") {
            window.history.back();
          } else {
            App.exitApp();
          }
        });
        backHandle = handle;
      } catch {
        // Plugin missing — ignore.
      }
    })();

    return () => {
      backHandle?.remove();
    };
  }, []);

  return null;
}
