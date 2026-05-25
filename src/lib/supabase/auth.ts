import { cache } from "react";
import { createClient } from "./server";
import type { UserRole } from "./types";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  full_name: string | null;
  password_set: boolean;
};

// React.cache memoizes for the lifetime of a single request. Proxy,
// layout, AppShell, and page all call this — Supabase is still hit at
// most once per nav (one auth + one profile select) instead of 3-5x.
export const getSessionUser = cache(
  async (): Promise<SessionUser | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, password_set")
      .eq("id", user.id)
      .single<{
        role: UserRole;
        full_name: string | null;
        password_set: boolean;
      }>();

    return {
      id: user.id,
      email: user.email ?? "",
      role: profile?.role ?? "teacher",
      full_name: profile?.full_name ?? null,
      password_set: profile?.password_set ?? true,
    };
  },
);
