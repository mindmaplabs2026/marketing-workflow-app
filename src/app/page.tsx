export default function Home() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const envConfigured = Boolean(supabaseUrl && supabaseAnonKey);

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Phase 0 · Foundations
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Marketing Workflow App
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Replacing WhatsApp chaos with one tracked pipeline for school
            clients and designers.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Supabase environment
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {envConfigured
              ? "Connected — NEXT_PUBLIC_SUPABASE_URL and anon key are set."
              : "Not configured yet. Copy .env.local.example to .env.local and fill in your Supabase keys."}
          </p>
          <div
            className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              envConfigured
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                envConfigured ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {envConfigured ? "Ready" : "Action needed"}
          </div>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Next up: Phase 1 — data model in Supabase.
        </p>
      </div>
    </main>
  );
}
