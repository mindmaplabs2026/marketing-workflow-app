"use client";

import { useEffect, useState } from "react";

// Bottom toast tied to a query-param trigger. The page renders it
// unconditionally when ?<paramName> is present; the component shows
// itself for ~3s, then strips the param from the URL so a refresh
// doesn't re-trigger it.
export function SuccessToast({
  message,
  paramName,
}: {
  message: string;
  paramName: string;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const dismissTimer = window.setTimeout(() => setVisible(false), 3000);
    const url = new URL(window.location.href);
    if (url.searchParams.has(paramName)) {
      url.searchParams.delete(paramName);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    return () => window.clearTimeout(dismissTimer);
  }, [paramName]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 sm:bottom-8"
    >
      <div className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-900/20 dark:bg-emerald-500">
        {message}
      </div>
    </div>
  );
}
