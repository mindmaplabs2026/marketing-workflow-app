import Link from "next/link";
import { getSessionUser } from "@/lib/supabase/auth";
import type { UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  designer: "Designer",
  school_admin: "School admin",
  teacher: "Teacher",
  decision_maker: "Decision maker",
};

const ROLE_NEXT_STEP: Record<UserRole, string> = {
  super_admin: "Manage schools and users, or jump into the request board.",
  designer:
    "Pick up approved requests, design, publish — all from the queue.",
  school_admin: "Raise new requests, approve drafts, and track what's in flight.",
  teacher: "Raise a request — your school admin gives the OK.",
  decision_maker:
    "See the month's plan and every post that's gone live for your school.",
};

type Card = {
  href: string;
  title: string;
  body: string;
  emphasis?: boolean;
};

function cardsFor(role: UserRole): Card[] {
  switch (role) {
    case "super_admin":
      return [
        { href: "/requests", title: "Open requests", body: "Cross-client view of every request.", emphasis: true },
        { href: "/calendar", title: "Monthly calendar", body: "Plan + approve across every school." },
        { href: "/feed", title: "Published posts", body: "Everything that's live, with links." },
        { href: "/admin", title: "Manage agency", body: "Add schools, invite users, assign designers." },
      ];
    case "designer":
      return [
        { href: "/requests", title: "Open requests", body: "See requests across your assigned schools.", emphasis: true },
        { href: "/calendar", title: "Monthly calendar", body: "Plan the month's posts and slots." },
        { href: "/feed", title: "Published posts", body: "Everything that's live, with links." },
      ];
    case "school_admin":
      return [
        { href: "/requests", title: "Open requests", body: "Approve drafts, see what's in flight.", emphasis: true },
        { href: "/calendar", title: "Monthly calendar", body: "Review the month's plan; approve what should go out." },
        { href: "/feed", title: "Published posts", body: "Every post that's gone live." },
      ];
    case "teacher":
      return [
        { href: "/requests", title: "Raise requests", body: "Raise a new one or check your drafts.", emphasis: true },
        { href: "/feed", title: "Published posts", body: "Every post that's gone live for your school." },
      ];
    case "decision_maker":
      return [
        { href: "/calendar", title: "Monthly calendar", body: "What's coming up for your school.", emphasis: true },
        { href: "/feed", title: "Published posts", body: "Every post that's gone live, with links." },
      ];
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const params = await searchParams;
  const session = await getSessionUser();

  if (!session) return null;

  const displayName = session.full_name?.trim() || session.email;
  const cards = cardsFor(session.role);
  const role = session.role;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="space-y-6">
        {params.denied && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            You don&apos;t have access to that page.
          </p>
        )}

        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Welcome back
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
            {displayName}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {ROLE_LABELS[role]} · {ROLE_NEXT_STEP[role]}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`block rounded-lg border p-4 transition-all ${
                card.emphasis
                  ? "border-violet-600 bg-gradient-to-br from-violet-600 to-violet-700 text-white shadow-sm hover:shadow-md hover:from-violet-700 hover:to-violet-800 dark:border-violet-500"
                  : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-violet-700"
              }`}
            >
              <p className="text-sm font-medium">{card.title} →</p>
              <p
                className={`mt-1 text-xs ${card.emphasis ? "opacity-80" : "text-zinc-500 dark:text-zinc-400"}`}
              >
                {card.body}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
