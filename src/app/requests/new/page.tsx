import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { NewRequestForm } from "./new-request-form";

type MembershipRow = {
  school_id: string;
  schools: { id: string; name: string } | null;
};

export default async function NewRequestPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();

  const role: UserRole = profile?.role ?? "teacher";
  if (role !== "teacher" && role !== "school_admin" && role !== "super_admin") {
    redirect("/requests");
  }

  let schools: { id: string; name: string }[] = [];
  if (role === "super_admin") {
    const { data } = await supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<{ id: string; name: string }[]>();
    schools = data ?? [];
  } else {
    const { data } = await supabase
      .from("school_members")
      .select("school_id, schools ( id, name )")
      .eq("user_id", user.id)
      .returns<MembershipRow[]>();
    schools = (data ?? [])
      .map((m) => m.schools)
      .filter((s): s is { id: string; name: string } => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (schools.length === 0) {
    return (
      <div className="space-y-6">
        <Link
          href="/requests"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All requests
        </Link>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              <path d="M3 9.5L12 4l9 5.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M9 21v-7h6v7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            You're not on a school yet.
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Ask a super admin to add you — then you can raise requests.
          </p>
        </div>
      </div>
    );
  }

  const willAutoApprove = role === "school_admin" || role === "super_admin";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/requests"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All requests
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Raise a request
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {willAutoApprove
            ? "Goes straight to the design team."
            : "Saves as a draft. Submit when ready — your school admin gives the OK."}
        </p>
      </div>

      <NewRequestForm schools={schools} />
    </div>
  );
}
