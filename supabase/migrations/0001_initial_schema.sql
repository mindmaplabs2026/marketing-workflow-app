-- =============================================================
-- Phase 1 — Initial schema
-- =============================================================
-- Tables, enums, indexes, triggers, and helper functions.
-- RLS policies live in 0002_rls_and_storage.sql; run this file FIRST.
--
-- How to apply:
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste this entire file → Run
--   3. Then do the same with 0002_rls_and_storage.sql
-- =============================================================


-- -------------------------------------------------------------
-- Enums
-- -------------------------------------------------------------

create type public.user_role as enum (
  'super_admin',
  'designer',
  'school_admin',
  'teacher',
  'decision_maker'
);

create type public.request_status as enum (
  'draft',                       -- teacher is still writing it
  'pending_admin_approval',      -- teacher submitted; school admin reviews
  'approved',                    -- school admin approved; designer queue
  'in_design',                   -- designer picked it up
  'design_pending_approval',     -- designer uploaded design; school admin reviews
  'changes_requested',           -- school admin sent design back
  'published',                   -- live on social media; link captured
  'archived'                     -- terminal cancelled state
);

create type public.calendar_item_status as enum (
  'drafted',                     -- design team drafted the plan slot
  'admin_approved',              -- school admin signed off on the slot
  'fulfilled',                   -- linked to a request that got published
  'cancelled'
);

create type public.social_platform as enum (
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'youtube',
  'other'
);


-- -------------------------------------------------------------
-- Shared utility: updated_at trigger
-- -------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -------------------------------------------------------------
-- schools
-- One row per client school.
-- -------------------------------------------------------------

create table public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger schools_set_updated_at
  before update on public.schools
  for each row execute function public.set_updated_at();


-- -------------------------------------------------------------
-- profiles
-- 1:1 with auth.users. Stores app-specific user data (role, name).
-- A trigger on auth.users auto-creates a matching profile row.
-- -------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        public.user_role not null default 'teacher',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a new auth.users row is inserted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -------------------------------------------------------------
-- school_members
-- Bridges users to schools.
--   - Teachers / school_admins / decision_makers: 1 row per school they belong to
--   - Designers: 1 row per school they are assigned to cover
--   - Super admins: NO rows here. Their access comes from role alone.
-- -------------------------------------------------------------

create table public.school_members (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (school_id, user_id)
);

create index school_members_school_idx on public.school_members(school_id);
create index school_members_user_idx   on public.school_members(user_id);


-- -------------------------------------------------------------
-- requests
-- The core workflow object. See request_status enum for state machine.
-- -------------------------------------------------------------

create table public.requests (
  id                      uuid primary key default gen_random_uuid(),
  school_id               uuid not null references public.schools(id) on delete restrict,
  created_by              uuid not null references public.profiles(id) on delete restrict,
  assigned_designer_id    uuid references public.profiles(id) on delete set null,
  approved_by             uuid references public.profiles(id) on delete set null,
  title                   text not null,
  description             text,
  status                  public.request_status not null default 'draft',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger requests_set_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

create index requests_school_idx       on public.requests(school_id);
create index requests_status_idx       on public.requests(status);
create index requests_designer_idx     on public.requests(assigned_designer_id);
create index requests_created_by_idx   on public.requests(created_by);


-- -------------------------------------------------------------
-- request_uploads
-- Photos / videos attached to a request by teachers or school admins.
-- File bytes live in Supabase Storage; this table holds metadata + path.
-- -------------------------------------------------------------

create table public.request_uploads (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete cascade,
  uploaded_by   uuid not null references public.profiles(id) on delete restrict,
  storage_path  text not null,
  mime_type     text,
  file_size     bigint,
  created_at    timestamptz not null default now()
);

create index request_uploads_request_idx on public.request_uploads(request_id);


-- -------------------------------------------------------------
-- designs
-- Designer-produced files. Multiple rows per request = revision history.
-- -------------------------------------------------------------

create table public.designs (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete cascade,
  uploaded_by   uuid not null references public.profiles(id) on delete restrict,
  storage_path  text not null,
  version       int not null default 1,
  notes         text,
  created_at    timestamptz not null default now()
);

create index designs_request_idx on public.designs(request_id);


-- -------------------------------------------------------------
-- calendar_items
-- Monthly content plan entries. Linked to a request once work begins.
-- -------------------------------------------------------------

create table public.calendar_items (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete cascade,
  created_by           uuid not null references public.profiles(id) on delete restrict,
  linked_request_id    uuid references public.requests(id) on delete set null,
  planned_date         date not null,
  title                text not null,
  description          text,
  status               public.calendar_item_status not null default 'drafted',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger calendar_items_set_updated_at
  before update on public.calendar_items
  for each row execute function public.set_updated_at();

create index calendar_items_school_idx       on public.calendar_items(school_id);
create index calendar_items_planned_date_idx on public.calendar_items(planned_date);


-- -------------------------------------------------------------
-- published_links
-- Final social media URLs the designer pastes back after publishing.
-- One request can have multiple links (e.g. same post on FB + Instagram).
-- -------------------------------------------------------------

create table public.published_links (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.requests(id) on delete cascade,
  posted_by     uuid not null references public.profiles(id) on delete restrict,
  platform      public.social_platform not null,
  url           text not null,
  posted_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index published_links_request_idx on public.published_links(request_id);


-- -------------------------------------------------------------
-- Helper functions used by RLS policies (in 0002).
-- Defined as SECURITY DEFINER + STABLE so they're efficient inside policies.
-- -------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'super_admin';
$$;

create or replace function public.is_member_of_school(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.school_members
    where user_id = auth.uid()
      and school_id = target_school_id
  );
$$;
