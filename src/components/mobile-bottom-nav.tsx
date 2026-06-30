"use client";

import { FloatingBottomNavigation } from "./FloatingBottomNavigation";
import type { UserRole } from "@/lib/supabase/types";

export function MobileBottomNav({ role }: { role: UserRole }) {
  return <FloatingBottomNavigation role={role} />;
}
