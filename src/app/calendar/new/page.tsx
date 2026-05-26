import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { NewCalendarItemForm } from "./new-calendar-item-form";
import { BackLink } from "@/components/back-link";

type SchoolLite = { id: string; name: string };
type MembershipRow = {
  school_id: string;
  schools: { id: string; name: string } | null;
};

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function NewCalendarItemPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string; date?: string }>;
}) {
  const { school: schoolParam, date: dateParam } = await searchParams;
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

  if (role !== "designer" && role !== "super_admin") {
    redirect("/calendar");
  }

  let schools: SchoolLite[] = [];
  if (role === "super_admin") {
    const { data } = await supabase
      .from("schools")
      .select("id, name")
      .order("name", { ascending: true })
      .returns<SchoolLite[]>();
    schools = data ?? [];
  } else {
    const { data } = await supabase
      .from("school_members")
      .select("school_id, schools ( id, name )")
      .eq("user_id", user.id)
      .returns<MembershipRow[]>();
    schools = (data ?? [])
      .map((m) => m.schools)
      .filter((s): s is SchoolLite => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (schools.length === 0) {
    return (
      <div className="space-y-6">
        <BackLink href="/calendar">Back to calendar</BackLink>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You're not assigned to any schools yet.
        </p>
      </div>
    );
  }

  const defaultSchool =
    schools.find((s) => s.id === schoolParam) ?? schools[0];
  const defaultDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : todayYMD();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <BackLink href={`/calendar?school=${defaultSchool.id}`}>Back to calendar</BackLink>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Plan a calendar item
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Draft now — your school admin approves before the design team builds it.
        </p>
      </div>

      <NewCalendarItemForm
        schools={schools}
        defaultSchoolId={defaultSchool.id}
        defaultDate={defaultDate}
      />
    </div>
  );
}
