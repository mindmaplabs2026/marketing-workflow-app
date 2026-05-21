-- =============================================================
-- Phase 8 — Notifications
-- =============================================================
-- One row per "something happened that you should look at."
-- Inserts are produced by SECURITY DEFINER triggers attached to
-- requests + calendar_items, so application code does NOT call
-- this table directly. Recipients can read + mark-as-read only.
--
-- Apply AFTER 0001 + 0002 in the Supabase SQL editor.
-- =============================================================


-- -------------------------------------------------------------
-- Enum: types of notifications we fan out.
-- -------------------------------------------------------------

create type public.notification_type as enum (
  'request_submitted_for_approval',  -- teacher submitted -> school_admin
  'request_approved',                -- admin approved   -> designers
  'request_sent_back_to_draft',      -- admin sent back  -> creator
  'design_uploaded_for_review',      -- designer uploaded-> school_admins
  'design_approved',                 -- admin approved   -> designer
  'design_changes_requested',        -- admin sent back  -> designer
  'request_published',               -- designer pub'd   -> school_admins + decision_makers + creator
  'calendar_item_approved'           -- admin approved   -> designers
);


-- -------------------------------------------------------------
-- notifications table
-- -------------------------------------------------------------

create table public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  recipient_id        uuid not null references public.profiles(id) on delete cascade,
  actor_id            uuid references public.profiles(id) on delete set null,
  type                public.notification_type not null,
  request_id          uuid references public.requests(id) on delete cascade,
  calendar_item_id    uuid references public.calendar_items(id) on delete cascade,
  body                text not null,
  read_at             timestamptz,
  created_at          timestamptz not null default now()
);

-- Hot path: "unread for me, newest first."
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, read_at, created_at desc);

create index notifications_request_idx  on public.notifications (request_id);
create index notifications_calendar_idx on public.notifications (calendar_item_id);


-- -------------------------------------------------------------
-- RLS
-- -------------------------------------------------------------

alter table public.notifications enable row level security;

-- Recipient (or super_admin for ops/debug) can read.
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (recipient_id = auth.uid() or public.is_super_admin());

-- Activity-log view: anyone in the school (except decision_makers) can read
-- request-scoped notifications for requests visible to them. This powers
-- the per-request timeline. RLS policies are OR-combined, so this widens
-- visibility without affecting the recipient-private unread count query.
create policy "notifications_select_request_activity"
  on public.notifications for select
  to authenticated
  using (
    request_id is not null
    and public.current_user_role() <> 'decision_maker'
    and exists (
      select 1 from public.requests r
      where r.id = notifications.request_id
        and public.is_member_of_school(r.school_id)
    )
  );

-- Recipient can flip read_at on their own rows.
create policy "notifications_update_own_read_state"
  on public.notifications for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- No client INSERT policy. Triggers (SECURITY DEFINER) own writes.
-- Super_admin can prune.
create policy "notifications_delete_super_admin_only"
  on public.notifications for delete
  to authenticated
  using (public.is_super_admin());


-- -------------------------------------------------------------
-- Helper: school members of a school with one of the given roles.
-- SECURITY DEFINER so trigger fan-out reads school_members regardless
-- of the actor's RLS scope.
-- -------------------------------------------------------------

create or replace function public.school_member_ids_with_roles(
  p_school_id uuid,
  p_roles public.user_role[]
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select sm.user_id
  from public.school_members sm
  join public.profiles p on p.id = sm.user_id
  where sm.school_id = p_school_id
    and p.role = any(p_roles);
$$;


-- -------------------------------------------------------------
-- Trigger: notify on request status transitions (and INSERT for
-- the "admin self-creates an approved request" path).
-- -------------------------------------------------------------

create or replace function public.notify_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_nil   uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_title text := coalesce(new.title, 'a request');
begin
  -- An admin/super_admin created a request that is already approved.
  -- (Calendar item approval also goes through this path.)
  if tg_op = 'INSERT' and new.status = 'approved' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'request_approved', new.id,
           'New request to design: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['designer']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);

    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then

    -- Teacher submitted draft -> notify school_admins.
    if new.status = 'pending_admin_approval' then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      select sm.user_id, v_actor, 'request_submitted_for_approval', new.id,
             'Request needs approval: ' || v_title
      from public.school_member_ids_with_roles(
             new.school_id, array['school_admin']::public.user_role[]) sm(user_id)
      where sm.user_id <> coalesce(v_actor, v_nil);

    -- Admin approved -> notify designers.
    elsif new.status = 'approved' then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      select sm.user_id, v_actor, 'request_approved', new.id,
             'New request to design: ' || v_title
      from public.school_member_ids_with_roles(
             new.school_id, array['designer']::public.user_role[]) sm(user_id)
      where sm.user_id <> coalesce(v_actor, v_nil);

    -- Admin sent draft back to teacher.
    elsif new.status = 'draft' and old.status = 'pending_admin_approval' then
      if new.created_by is not null
         and new.created_by <> coalesce(v_actor, v_nil) then
        insert into public.notifications (recipient_id, actor_id, type, request_id, body)
        values (new.created_by, v_actor, 'request_sent_back_to_draft', new.id,
                'Your draft was sent back: ' || v_title);
      end if;

    -- Designer uploaded a design -> notify school_admins.
    elsif new.status = 'design_pending_approval' then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      select sm.user_id, v_actor, 'design_uploaded_for_review', new.id,
             'Design ready to review: ' || v_title
      from public.school_member_ids_with_roles(
             new.school_id, array['school_admin']::public.user_role[]) sm(user_id)
      where sm.user_id <> coalesce(v_actor, v_nil);

    -- Admin approved the design -> publish-ready, designer's turn again.
    elsif new.status = 'in_design' and old.status = 'design_pending_approval' then
      if new.assigned_designer_id is not null
         and new.assigned_designer_id <> coalesce(v_actor, v_nil) then
        insert into public.notifications (recipient_id, actor_id, type, request_id, body)
        values (new.assigned_designer_id, v_actor, 'design_approved', new.id,
                'Design approved, ready to publish: ' || v_title);
      end if;

    -- Admin sent design back for changes.
    elsif new.status = 'changes_requested' then
      if new.assigned_designer_id is not null
         and new.assigned_designer_id <> coalesce(v_actor, v_nil) then
        insert into public.notifications (recipient_id, actor_id, type, request_id, body)
        values (new.assigned_designer_id, v_actor, 'design_changes_requested', new.id,
                'Changes requested on: ' || v_title);
      end if;

    -- Published -> school_admins + decision_makers (+ creator, if not already in that set).
    elsif new.status = 'published' then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      select sm.user_id, v_actor, 'request_published', new.id,
             'Published: ' || v_title
      from public.school_member_ids_with_roles(
             new.school_id,
             array['school_admin','decision_maker']::public.user_role[]) sm(user_id)
      where sm.user_id <> coalesce(v_actor, v_nil);

      if new.created_by is not null
         and new.created_by <> coalesce(v_actor, v_nil)
         and not exists (
           select 1
           from public.school_members sm
           join public.profiles p on p.id = sm.user_id
           where sm.school_id = new.school_id
             and sm.user_id = new.created_by
             and p.role in ('school_admin', 'decision_maker')
         )
      then
        insert into public.notifications (recipient_id, actor_id, type, request_id, body)
        values (new.created_by, v_actor, 'request_published', new.id,
                'Your request is live: ' || v_title);
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger requests_notify
  after insert or update on public.requests
  for each row execute function public.notify_on_request_change();


-- -------------------------------------------------------------
-- Trigger: calendar item approval -> notify designers.
-- (Approval also inserts a linked requests row; that fan-out is
-- handled by the requests trigger above, so designers get *both*
-- a calendar_item_approved and a request_approved notification.
-- Both are useful: the first is "the slot is locked in,"
-- the second is "here's the queued work.")
-- -------------------------------------------------------------

create or replace function public.notify_on_calendar_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_nil   uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_title text := coalesce(new.title, 'a calendar item');
begin
  if tg_op = 'UPDATE'
     and new.status = 'admin_approved'
     and new.status is distinct from old.status then
    insert into public.notifications (recipient_id, actor_id, type, calendar_item_id, body)
    select sm.user_id, v_actor, 'calendar_item_approved', new.id,
           'Calendar item approved: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['designer']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);
  end if;
  return new;
end;
$$;

create trigger calendar_items_notify
  after update on public.calendar_items
  for each row execute function public.notify_on_calendar_item_change();
