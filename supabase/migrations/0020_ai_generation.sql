-- =============================================================
-- 0020 — AI Poster Generation
-- =============================================================
-- Adds tables, enums, triggers, RLS policies, and a storage
-- bucket to support the AI poster generation pipeline.
--
-- Depends on: 0001 (base schema), 0002 (RLS helpers), 0011 (notify helper)
-- =============================================================


-- -------------------------------------------------------------
-- New enums
-- -------------------------------------------------------------

create type public.ai_job_status as enum (
  'queued',
  'understanding',
  'creative',
  'generating',
  'completed',
  'failed'
);

create type public.chat_message_role as enum (
  'user',
  'assistant',
  'system'
);

-- Extend notification_type for AI events
alter type public.notification_type add value 'ai_generation_completed';
alter type public.notification_type add value 'ai_generation_failed';


-- -------------------------------------------------------------
-- requests: add ai_generated flag
-- -------------------------------------------------------------

alter table public.requests
  add column ai_generated boolean not null default false;


-- -------------------------------------------------------------
-- school_brand_assets
-- Pre-configured per school: logo, header, footer, uniform,
-- infrastructure images.
-- -------------------------------------------------------------

create table public.school_brand_assets (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete cascade,
  asset_type   text not null check (asset_type in ('logo','header','footer','uniform','infrastructure')),
  storage_path text not null,
  mime_type    text,
  file_size    bigint,
  label        text,
  uploaded_by  uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  unique (school_id, asset_type, storage_path)
);

create index school_brand_assets_school_idx
  on public.school_brand_assets(school_id);


-- -------------------------------------------------------------
-- ai_generation_jobs
-- Tracks an AI pipeline run for a request.
-- -------------------------------------------------------------

create table public.ai_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.requests(id) on delete cascade,
  status          public.ai_job_status not null default 'queued',
  inngest_run_id  text,
  agent1_output   jsonb,
  agent2_output   jsonb,
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index ai_generation_jobs_request_idx
  on public.ai_generation_jobs(request_id);

create trigger ai_generation_jobs_set_updated_at
  before update on public.ai_generation_jobs
  for each row execute function public.set_updated_at();


-- -------------------------------------------------------------
-- ai_variations
-- Each job produces 3 variations. Teacher picks one.
-- -------------------------------------------------------------

create table public.ai_variations (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.ai_generation_jobs(id) on delete cascade,
  request_id       uuid not null references public.requests(id) on delete cascade,
  variation_index  smallint not null check (variation_index between 1 and 3),
  creative_brief   jsonb not null,
  storage_paths    text[] not null default '{}',
  poster_type      text not null check (poster_type in ('single','carousel')),
  is_accepted      boolean not null default false,
  chat_rounds_used smallint not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (job_id, variation_index)
);

create index ai_variations_request_idx on public.ai_variations(request_id);
create index ai_variations_job_idx     on public.ai_variations(job_id);

create trigger ai_variations_set_updated_at
  before update on public.ai_variations
  for each row execute function public.set_updated_at();


-- -------------------------------------------------------------
-- ai_chat_messages
-- Per-variation chat thread for iterative editing.
-- -------------------------------------------------------------

create table public.ai_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  variation_id  uuid not null references public.ai_variations(id) on delete cascade,
  role          public.chat_message_role not null,
  content       text not null,
  image_paths   text[] default '{}',
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index ai_chat_messages_variation_idx
  on public.ai_chat_messages(variation_id, created_at);


-- =============================================================
-- Storage bucket: school-assets
-- =============================================================

insert into storage.buckets (id, name, public)
values ('school-assets', 'school-assets', false)
on conflict (id) do nothing;


-- =============================================================
-- RLS — Enable on new tables
-- =============================================================

alter table public.school_brand_assets  enable row level security;
alter table public.ai_generation_jobs   enable row level security;
alter table public.ai_variations        enable row level security;
alter table public.ai_chat_messages     enable row level security;


-- ---------- school_brand_assets ----------

create policy "school_brand_assets_select"
  on public.school_brand_assets for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_member_of_school(school_id)
  );

create policy "school_brand_assets_insert"
  on public.school_brand_assets for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      public.is_super_admin()
      or (
        public.is_member_of_school(school_id)
        and public.current_user_role() = 'school_admin'
      )
    )
  );

create policy "school_brand_assets_delete"
  on public.school_brand_assets for delete
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_member_of_school(school_id)
      and public.current_user_role() = 'school_admin'
    )
  );


-- ---------- ai_generation_jobs ----------
-- SELECT for school members; writes via service role (Inngest pipeline).

create policy "ai_generation_jobs_select"
  on public.ai_generation_jobs for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = ai_generation_jobs.request_id
        and public.is_member_of_school(r.school_id)
        and public.current_user_role() <> 'decision_maker'
    )
  );

-- Allow the request creator to insert the initial job row
create policy "ai_generation_jobs_insert"
  on public.ai_generation_jobs for insert
  to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = ai_generation_jobs.request_id
        and r.created_by = auth.uid()
    )
  );


-- ---------- ai_variations ----------

create policy "ai_variations_select"
  on public.ai_variations for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = ai_variations.request_id
        and public.is_member_of_school(r.school_id)
        and public.current_user_role() <> 'decision_maker'
    )
  );

-- Request creator can accept a variation
create policy "ai_variations_update"
  on public.ai_variations for update
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = ai_variations.request_id
        and r.created_by = auth.uid()
    )
  )
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = ai_variations.request_id
        and r.created_by = auth.uid()
    )
  );


-- ---------- ai_chat_messages ----------

create policy "ai_chat_messages_select"
  on public.ai_chat_messages for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.ai_variations v
      join public.requests r on r.id = v.request_id
      where v.id = ai_chat_messages.variation_id
        and public.is_member_of_school(r.school_id)
        and public.current_user_role() <> 'decision_maker'
    )
  );

-- Request creator can send chat messages
create policy "ai_chat_messages_insert"
  on public.ai_chat_messages for insert
  to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1 from public.ai_variations v
      join public.requests r on r.id = v.request_id
      where v.id = ai_chat_messages.variation_id
        and r.created_by = auth.uid()
    )
  );


-- ---------- school-assets storage bucket ----------

create policy "storage_school_assets_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'school-assets'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.schools s
        where s.id::text = (storage.foldername(name))[1]
          and public.is_member_of_school(s.id)
      )
    )
  );

create policy "storage_school_assets_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'school-assets'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.schools s
        where s.id::text = (storage.foldername(name))[1]
          and public.is_member_of_school(s.id)
          and public.current_user_role() = 'school_admin'
      )
    )
  );

create policy "storage_school_assets_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'school-assets'
    and (public.is_super_admin() or owner = auth.uid())
  );


-- =============================================================
-- Notification trigger for AI job completion / failure
-- =============================================================

create or replace function public.notify_on_ai_job_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if old.status is not distinct from new.status then return new; end if;

  select r.title, r.created_by, r.school_id
  into v_request
  from public.requests r
  where r.id = new.request_id;

  if v_request is null then return new; end if;

  if new.status = 'completed' then
    insert into public.notifications (recipient_id, type, request_id, body)
    values (
      v_request.created_by,
      'ai_generation_completed',
      new.request_id,
      'AI posters ready for review: ' || coalesce(v_request.title, 'a request')
    );

  elsif new.status = 'failed' then
    insert into public.notifications (recipient_id, type, request_id, body)
    values (
      v_request.created_by,
      'ai_generation_failed',
      new.request_id,
      'AI generation failed for: ' || coalesce(v_request.title, 'a request')
    );
  end if;

  return new;
end;
$$;

create trigger ai_generation_jobs_notify
  after update on public.ai_generation_jobs
  for each row execute function public.notify_on_ai_job_change();
