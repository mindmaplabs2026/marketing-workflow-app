import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CreateSchoolForm } from "./create-school-form";

type SchoolRow = {
  id: string;
  name: string;
  created_at: string;
};

export default async function SchoolsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schools")
    .select("id, name, created_at")
    .order("name", { ascending: true })
    .returns<SchoolRow[]>();

  const schools = data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Schools
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {schools.length} client{schools.length === 1 ? "" : "s"}.
        </p>
      </div>

      <CreateSchoolForm />

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error.message}
        </p>
      )}

      {schools.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No schools yet. Add your first one above.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {schools.map((school) => (
            <li key={school.id}>
              <Link
                href={`/admin/schools/${school.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {school.name}
                </span>
                <span className="text-xs text-zinc-500">Manage →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
