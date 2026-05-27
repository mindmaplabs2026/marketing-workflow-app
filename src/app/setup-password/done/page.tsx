"use client";

import { useEffect } from "react";

// Tiny stepping-stone page. The setPassword action redirects here, then
// this page does a hard window.location nav to /. We can't redirect
// straight to / from the action because that's a soft transition — the
// root layout (cached as shell-free from /setup-password) would not
// re-run, and the home page would render without AppShell. We also
// can't return success and use a client-side window.location in the
// form, because Next.js revalidates /setup-password after the action,
// the page sees password_set=true, swaps to AlreadySetNotice, and
// unmounts the form before its useEffect can fire.
export default function SetupPasswordDonePage() {
  useEffect(() => {
    window.location.replace("/");
  }, []);
  return null;
}
