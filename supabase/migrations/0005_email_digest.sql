-- =============================================================
-- Phase 10 — Email digest fallback
-- =============================================================
-- Adds:
--   - a per-user email preference (off / daily / immediate)
--   - notifications.emailed_at marker so the dispatcher is idempotent
--   - partial index on the unemailed hot path
--
-- Default preference is 'daily' — clarity doc's morning-glance
-- scenario. Users can opt out from the /notifications page.
--
-- Apply AFTER 0004 in the Supabase SQL editor.
-- =============================================================


-- -------------------------------------------------------------
-- Enum + profile column
-- -------------------------------------------------------------

create type public.notification_email_pref as enum (
  'off',
  'daily',
  'immediate'
);

alter table public.profiles
  add column if not exists email_pref public.notification_email_pref
    not null default 'daily';


-- -------------------------------------------------------------
-- Notification marker for "email already sent"
-- -------------------------------------------------------------

alter table public.notifications
  add column if not exists emailed_at timestamptz;

create index if not exists notifications_email_pending_idx
  on public.notifications (recipient_id, created_at)
  where emailed_at is null;
