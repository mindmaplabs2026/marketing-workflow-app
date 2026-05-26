import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  CalendarItemStatus,
  RequestStatus,
  UserRole,
} from "@/lib/supabase/types";
import {
  CAL_STATUS_BADGE_CLASS,
  CAL_STATUS_LABELS,
} from "../status";
import {
  STATUS_LABELS as REQ_STATUS_LABELS,
  STATUS_BADGE_CLASS as REQ_STATUS_BADGE_CLASS,
} from "../../requests/status";
import {
  approveCalendarItem,
  cancelCalendarItem,
  updateCalendarItem,
} from "../actions";
import { BackLink } from "@/components/back-link";

type CalendarItemDetail = {
  id: string;
  school_id: string;
  created_by: string;
  linked_request_id: string | null;
  planned_date: string;
  title: string;
  description: string | null;
  status: CalendarItemStatus;
  feedback: string | null;
  created_at: string;
};

type LinkedRequest = {
  id: string;
  title: string;
  status: RequestStatus;
};

function formatDateLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function CalendarItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const { data: item } = await supabase
    .from("calendar_items")
    .select(
      "id, school_id, created_by, linked_request_id, planned_date, title, description, status, feedback, created_at",
    )
    .eq("id", id)
    .single<CalendarItemDetail>();
  if (!item) notFound();

  if (
    role === "decision_maker" &&
    (item.status === "drafted" || item.status === "cancelled")
  ) {
    redirect(`/calendar?school=${item.school_id}`);
  }

  const [{ data: schoolRow }, { data: creator }] = await Promise.all([
    supabase
      .from("schools")
      .select("name")
      .eq("id", item.school_id)
      .single<{ name: string }>(),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", item.created_by)
      .single<{ full_name: string | null }>(),
  ]);

  let linkedRequest: LinkedRequest | null = null;
  if (item.linked_request_id) {
    const { data } = await supabase
      .from("requests")
      .select("id, title, status")
      .eq("id", item.linked_request_id)
      .single<LinkedRequest>();
    linkedRequest = data ?? null;
  }

  const isReviewer = role === "school_admin" || role === "super_admin";
  const isDesigner = role === "designer" || role === "super_admin";

  const canEdit =
    item.status === "drafted" && (isDesigner || isReviewer);
  const canApprove = item.status === "drafted" && isReviewer;
  const canCancel =
    item.status !== "fulfilled" &&
    item.status !== "cancelled" &&
    (isDesigner || isReviewer);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <BackLink href={`/calendar?school=${item.school_id}`}>Back to calendar</BackLink>
        <div className="mt-2 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {item.title}
          </h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${CAL_STATUS_BADGE_CLASS[item.status]}`}
          >
            {CAL_STATUS_LABELS[item.status]}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {formatDateLong(item.planned_date)}
          {schoolRow?.name ? ` · ${schoolRow.name}` : ""}
          {creator?.full_name?.trim() ? ` · drafted by ${creator.full_name}` : ""}
        </p>
      </div>

      {canEdit ? (
        <form action={updateCalendarItem} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="id" value={item.id} />
          <div>
            <label
              htmlFor="title"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Title
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              defaultValue={item.title}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label
              htmlFor="planned_date"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Date
            </label>
            <input
              id="planned_date"
              name="planned_date"
              type="date"
              required
              defaultValue={item.planned_date}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Notes
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={item.description ?? ""}
              className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Save changes
          </button>
        </form>
      ) : (
        item.description && (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <p className="whitespace-pre-wrap">{item.description}</p>
          </div>
        )
      )}

      {linkedRequest && role !== "decision_maker" && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            In the pipeline
          </p>
          <Link
            href={`/requests/${linkedRequest.id}`}
            className="mt-2 flex items-center justify-between gap-3 text-sm font-medium text-zinc-900 hover:underline dark:text-zinc-50"
          >
            <span className="truncate">{linkedRequest.title}</span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${REQ_STATUS_BADGE_CLASS[linkedRequest.status]}`}
            >
              {REQ_STATUS_LABELS[linkedRequest.status]}
            </span>
          </Link>
        </div>
      )}

      {item.feedback && (
        <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/40 dark:bg-rose-900/20">
          <p className="text-xs font-medium uppercase tracking-widest text-rose-700 dark:text-rose-300">
            Feedback from school admin
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-rose-900 dark:text-rose-100">
            {item.feedback}
          </p>
        </div>
      )}

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        {canApprove && (
          <form action={approveCalendarItem}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              Approve &amp; send to design team
            </button>
          </form>
        )}
        {canCancel && (
          <form action={cancelCalendarItem} className="space-y-2">
            <input type="hidden" name="id" value={item.id} />
            <details className="text-xs">
              <summary className="cursor-pointer text-zinc-500 hover:text-red-600 dark:hover:text-red-400">
                Cancel item
              </summary>
              <div className="mt-2 space-y-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <label
                  htmlFor="feedback"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Optional note (the designer will see this)
                </label>
                <textarea
                  id="feedback"
                  name="feedback"
                  rows={3}
                  placeholder="e.g. Move this to next month — exam week."
                  className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                />
                <button
                  type="submit"
                  className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300"
                >
                  Cancel item
                </button>
              </div>
            </details>
          </form>
        )}
      </section>
    </div>
  );
}
