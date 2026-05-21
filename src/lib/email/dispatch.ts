import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  appUrl,
  emailFrom,
  resendClient,
} from "./client";
import type {
  NotificationEmailPref,
  NotificationType,
} from "@/lib/supabase/types";

type PendingRow = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  body: string;
  request_id: string | null;
  calendar_item_id: string | null;
  created_at: string;
};

type ProfileLite = {
  id: string;
  full_name: string | null;
  email_pref: NotificationEmailPref;
};

function deepLinkFor(row: PendingRow, base: string): string {
  if (row.request_id) return `${base}/requests/${row.request_id}`;
  if (row.calendar_item_id) return `${base}/calendar/${row.calendar_item_id}`;
  return `${base}/notifications`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDigestHtml(
  fullName: string | null,
  rows: PendingRow[],
  base: string,
): { html: string; text: string; subject: string } {
  const name = fullName?.trim() || "there";
  const count = rows.length;
  const subject =
    count === 1
      ? `1 thing needs your attention`
      : `${count} things need your attention`;

  const itemHtml = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e4e4e7">
          <a href="${escapeHtml(deepLinkFor(r, base))}"
             style="color:#18181b;text-decoration:none;font-weight:500">
            ${escapeHtml(r.body)}
          </a>
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#fafafa;margin:0;padding:24px">
  <table cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e4e7;border-radius:8px;padding:24px">
    <tr><td>
      <p style="margin:0;color:#52525b;font-size:13px">Marketing Workflow</p>
      <h1 style="margin:8px 0 4px;font-size:20px;color:#18181b">Hi ${escapeHtml(name)},</h1>
      <p style="margin:0;color:#52525b;font-size:14px">Here's what's waiting in the queue:</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:16px">${itemHtml}</table>
      <p style="margin:24px 0 0;font-size:13px">
        <a href="${escapeHtml(base)}/notifications"
           style="display:inline-block;background:#18181b;color:#fafafa;padding:10px 16px;border-radius:6px;text-decoration:none">
          Open the queue →
        </a>
      </p>
      <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px">
        You can change how often we email you on the
        <a href="${escapeHtml(base)}/notifications" style="color:#71717a">notifications page</a>.
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text =
    `Hi ${name},\n\nHere's what's waiting in the queue:\n\n` +
    rows.map((r) => `• ${r.body}\n  ${deepLinkFor(r, base)}`).join("\n") +
    `\n\nOpen the queue: ${base}/notifications\n`;

  return { html, text, subject };
}

async function fetchEmailsByIds(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  // The auth admin API doesn't expose a batch getById, so we paginate
  // listUsers (15-school agency = small user count, one page covers it).
  const out = new Map<string, string>();
  const wanted = new Set(ids);
  let page = 1;
  const perPage = 200;
  while (wanted.size > 0) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    for (const u of data.users) {
      if (wanted.has(u.id) && u.email) {
        out.set(u.id, u.email);
        wanted.delete(u.id);
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return out;
}

async function sendBatch(params: {
  admin: ReturnType<typeof createAdminClient>;
  recipientId: string;
  email: string;
  fullName: string | null;
  rows: PendingRow[];
}): Promise<{ sent: boolean; error?: string }> {
  const { admin, email, fullName, rows } = params;
  const resend = resendClient();
  if (!resend) return { sent: false, error: "Resend not configured" };

  const { subject, html, text } = renderDigestHtml(fullName, rows, appUrl());

  try {
    const { error } = await resend.emails.send({
      from: emailFrom(),
      to: email,
      subject,
      html,
      text,
    });
    if (error) {
      console.error("resend send error", error);
      return { sent: false, error: error.message };
    }
  } catch (e) {
    console.error("resend exception", e);
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }

  await admin
    .from("notifications")
    .update({ emailed_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id),
    );

  return { sent: true };
}

// Drain unread + un-emailed notifications grouped per recipient with
// pref in (`pref`). Returns the number of emails sent.
async function drain(pref: NotificationEmailPref[]): Promise<number> {
  if (!resendClient()) return 0;
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("notifications")
    .select(
      "id, recipient_id, type, body, request_id, calendar_item_id, created_at",
    )
    .is("emailed_at", null)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<PendingRow[]>();
  if (error) {
    console.error("drain query failed", error);
    return 0;
  }
  if (!rows || rows.length === 0) return 0;

  const recipientIds = Array.from(new Set(rows.map((r) => r.recipient_id)));
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, email_pref")
    .in("id", recipientIds)
    .in("email_pref", pref)
    .returns<ProfileLite[]>();
  const profileById = new Map(
    (profiles ?? []).map((p) => [p.id, p] as const),
  );

  // Filter rows down to those whose recipient matched the pref filter.
  const eligible = rows.filter((r) => profileById.has(r.recipient_id));
  if (eligible.length === 0) return 0;

  const emailById = await fetchEmailsByIds(
    admin,
    Array.from(new Set(eligible.map((r) => r.recipient_id))),
  );

  // Group rows per recipient.
  const grouped = new Map<string, PendingRow[]>();
  for (const r of eligible) {
    const list = grouped.get(r.recipient_id) ?? [];
    list.push(r);
    grouped.set(r.recipient_id, list);
  }

  let sent = 0;
  for (const [recipientId, batch] of grouped) {
    const profile = profileById.get(recipientId)!;
    const email = emailById.get(recipientId);
    if (!email) {
      // No email = nothing to send to. Mark as emailed so we don't loop.
      await admin
        .from("notifications")
        .update({ emailed_at: new Date().toISOString() })
        .in(
          "id",
          batch.map((r) => r.id),
        );
      continue;
    }
    const result = await sendBatch({
      admin,
      recipientId,
      email,
      fullName: profile.full_name,
      rows: batch,
    });
    if (result.sent) sent += 1;
  }
  return sent;
}

// Daily digest — drains for users on 'daily' OR 'immediate' (immediate
// users may have missed in-the-moment sends if the dispatcher errored).
export function dispatchDailyDigest(): Promise<number> {
  return drain(["daily", "immediate"]);
}

// Called from server actions right after dispatchPendingPushes.
// Targets only 'immediate' users — 'daily' users wait for the cron.
export async function dispatchImmediateEmails(): Promise<void> {
  if (!resendClient()) return;
  try {
    await drain(["immediate"]);
  } catch (e) {
    console.warn(
      "immediate email dispatch failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
