-- =============================================================
-- Phase 9 — Push subscriptions + dispatch idempotency
-- =============================================================
-- One row per (user, browser/device). A user can install the PWA
-- on multiple devices; each gets its own subscription endpoint.
--
-- Also adds `pushed_at` to notifications so the dispatcher can
-- drain only what hasn't been pushed yet.
--
-- Apply AFTER 0003 in the Supabase SQL editor.
-- =============================================================


-- -------------------------------------------------------------
-- push_subscriptions
-- -------------------------------------------------------------

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);


-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------

alter table public.push_subscriptions enable row level security;

-- A user can manage their own subscriptions; super_admin can read for ops.
create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());


-- -------------------------------------------------------------
-- Notifications: track when a push went out so the dispatcher
-- is idempotent (it only drains rows where pushed_at is null).
-- -------------------------------------------------------------

alter table public.notifications
  add column if not exists pushed_at timestamptz;

create index if not exists notifications_pushed_pending_idx
  on public.notifications (created_at)
  where pushed_at is null;
