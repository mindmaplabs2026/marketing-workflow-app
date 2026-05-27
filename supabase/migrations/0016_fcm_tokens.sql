-- =============================================================
-- FCM tokens — parallel channel to push_subscriptions, for native
-- Android (.apk) users. Capacitor's @capacitor/push-notifications
-- plugin returns an FCM device token; the server sends through
-- firebase-admin instead of web-push.
--
-- Apply AFTER 0015.
-- =============================================================

create table public.fcm_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  token        text not null unique,
  platform     text not null default 'android',
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index fcm_tokens_user_idx on public.fcm_tokens (user_id);


-- -------------------------------------------------------------
-- RLS — same shape as push_subscriptions
-- -------------------------------------------------------------

alter table public.fcm_tokens enable row level security;

create policy "fcm_tokens_select_own"
  on public.fcm_tokens for select
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create policy "fcm_tokens_insert_own"
  on public.fcm_tokens for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "fcm_tokens_update_own"
  on public.fcm_tokens for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "fcm_tokens_delete_own"
  on public.fcm_tokens for delete
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
