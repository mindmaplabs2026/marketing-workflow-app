"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Refetches the current route's server components whenever the
// tab/window gains focus or comes back to the foreground. Cheap (only
// the RSC payload, not a full page reload) and preserves client
// component state — forms, scroll, dropdowns all stay put. Throttled to
// once every 5s so rapid alt-tabs don't hammer the server.
const THROTTLE_MS = 5000;

export function RefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    let last = 0;

    function refresh() {
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      router.refresh();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
