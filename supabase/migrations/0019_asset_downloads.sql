-- =============================================================
-- 0019 — asset_downloads audit log
-- =============================================================
-- Records every multi-asset download initiated via /api/assets/download.
-- Single-file downloads through the same endpoint are logged too. Only
-- super_admin can read the log; any authenticated user can write a row
-- about themselves (the route enforces user_id = auth.uid()).

create table if not exists public.asset_downloads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  request_id  uuid not null references public.requests(id) on delete cascade,
  asset_kind  text not null check (asset_kind in ('upload', 'design', 'mixed')),
  file_count  integer not null check (file_count > 0),
  paths       text[] not null,
  created_at  timestamptz not null default now()
);

create index if not exists asset_downloads_request_id_idx
  on public.asset_downloads (request_id);
create index if not exists asset_downloads_user_id_idx
  on public.asset_downloads (user_id);
create index if not exists asset_downloads_created_at_idx
  on public.asset_downloads (created_at desc);

alter table public.asset_downloads enable row level security;

drop policy if exists "asset_downloads_select_super_admin" on public.asset_downloads;
create policy "asset_downloads_select_super_admin"
  on public.asset_downloads for select
  to authenticated
  using (public.is_super_admin());

drop policy if exists "asset_downloads_insert_self" on public.asset_downloads;
create policy "asset_downloads_insert_self"
  on public.asset_downloads for insert
  to authenticated
  with check (user_id = auth.uid());
