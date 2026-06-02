"use client";

import { useEffect } from "react";

// Stepping-stone page. The changePassword action redirects here, then
// this page hard-navigates to /?changed=password. The home page reads
// the query param and shows a "Password changed successfully" toast.
// A soft redirect from a shell-free route would not re-run the root
// layout, so the AppShell would not render until the next nav.
export default function ChangePasswordDonePage() {
  useEffect(() => {
    window.location.replace("/?changed=password");
  }, []);
  return null;
}
