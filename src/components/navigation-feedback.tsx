"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

function isPlainLeftClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function isAppNavigation(anchor: HTMLAnchorElement): boolean {
  if (anchor.target && anchor.target !== "_self") return false;
  if (anchor.hasAttribute("download")) return false;

  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return false;

  const url = new URL(anchor.href);
  return url.origin === window.location.origin && url.href !== window.location.href;
}

export function NavigationFeedback() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!isPlainLeftClick(event)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isAppNavigation(anchor)) return;

      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      setLoading(true);
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!loading) return;

    hideTimer.current = window.setTimeout(() => {
      setLoading(false);
    }, 180);
  }, [pathname, loading]);

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden bg-transparent transition-opacity duration-150 ${
        loading ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="h-full w-1/2 animate-[navigation-progress_950ms_ease-in-out_infinite] rounded-r-full bg-violet-600 shadow-[0_0_12px_rgba(124,58,237,0.45)] dark:bg-violet-400" />
    </div>
  );
}
