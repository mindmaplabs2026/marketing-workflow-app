import { createAdminClient } from "@/lib/supabase/admin";
import type { RequestStatus } from "@/lib/supabase/types";
import { LoginForm, type LoginWorkflowStep } from "./login-form";

type WorkflowGroup = {
  title: string;
  statuses: RequestStatus[];
  badge: string;
  emptyText: string;
};

const workflowGroups: WorkflowGroup[] = [
  {
    title: "Request submitted",
    statuses: ["pending_admin_approval"],
    badge: "Submitted",
    emptyText: "No submitted requests",
  },
  {
    title: "With design team",
    statuses: ["approved", "in_design", "changes_requested"],
    badge: "In progress",
    emptyText: "No active design work",
  },
  {
    title: "Awaiting approval",
    statuses: ["design_pending_approval"],
    badge: "Pending",
    emptyText: "No approval queue",
  },
  {
    title: "Published",
    statuses: ["published"],
    badge: "Live",
    emptyText: "No published posts yet",
  },
];

function formatCount(count: number | null, emptyText: string): string {
  if (!count) return emptyText;
  return count === 1 ? "1 request" : `${count} requests`;
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return "Just now";

  const diffMs = Date.now() - new Date(iso).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Now";
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return `${Math.floor(diffMs / day)}d ago`;
}

async function getSafeWorkflowSteps(): Promise<LoginWorkflowStep[] | undefined> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return undefined;
  }

  try {
    const supabase = createAdminClient();
    const results = await Promise.all(
      workflowGroups.map(async (group) => {
        const { count, data, error } = await supabase
          .from("requests")
          .select("updated_at", { count: "exact" })
          .in("status", group.statuses)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (error) throw error;

        return {
          title: group.title,
          school: formatCount(count, group.emptyText),
          status: group.badge,
          time: count ? formatRelativeTime(data?.[0]?.updated_at) : "No activity",
        };
      }),
    );

    return results;
  } catch {
    return undefined;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const workflowSteps = await getSafeWorkflowSteps();

  return <LoginForm initialError={error} workflowSteps={workflowSteps} />;
}
