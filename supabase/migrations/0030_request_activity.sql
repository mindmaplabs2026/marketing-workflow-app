-- 0030: Durable request activity log
--
-- Notifications are recipient fan-out rows. They are useful for unread counts,
-- push, and email, but they are not a complete audit trail. This table records
-- one canonical activity item per request workflow action.

create type public.request_activity_type as enum (
  'request_created',
  'request_submitted',
  'request_approved',
  'request_sent_back',
  'request_picked_up',
  'design_submitted',
  'design_approved',
  'design_changes_requested',
  'request_published',
  'request_archived'
);

create table public.request_activities (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  type        public.request_activity_type not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index request_activities_request_created_idx
  on public.request_activities (request_id, created_at);

create index request_activities_actor_idx
  on public.request_activities (actor_id);

alter table public.request_activities enable row level security;

create policy "request_activities_select_visible_request"
  on public.request_activities for select
  to authenticated
  using (
    exists (
      select 1
      from public.requests r
      where r.id = request_activities.request_id
        and public.current_user_role() <> 'decision_maker'
        and public.is_member_of_school(r.school_id)
    )
    or public.is_super_admin()
  );

create policy "request_activities_insert_actor_visible_request"
  on public.request_activities for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1
      from public.requests r
      where r.id = request_activities.request_id
        and public.is_member_of_school(r.school_id)
    )
  );

