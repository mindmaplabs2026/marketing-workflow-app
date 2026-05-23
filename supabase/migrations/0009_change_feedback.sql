-- Add a feedback column to requests so admins can explain what changes
-- they want when sending back a request or design. The trigger reads
-- this value and includes it in the notification body + stores it in
-- a dedicated notifications.feedback column for display in the activity log.

-- 1. Add feedback column to requests (transient — written before status change, read by trigger)
alter table public.requests
  add column if not exists change_feedback text;

-- 2. Add feedback column to notifications (persistent — displayed in activity timeline)
alter table public.notifications
  add column if not exists feedback text;

-- 3. Update the notification trigger to include feedback text
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
  v_feedback text := new.change_feedback;
  v_body  text;
begin
  -- An admin/super_admin created a request that is already approved.
  if tg_op = 'INSERT' and new.status = 'approved' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'request_approved', new.id,
           'New request to design: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['designer']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);

    return new;
  end if;

  if tg_op <> 'UPDATE' then return new; end if;
  if old.status = new.status then return new; end if;

  -- teacher submitted -> school_admin(s) + super_admin(s)
  if new.status = 'pending_admin_approval' and old.status = 'draft' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'request_submitted_for_approval', new.id,
           'Request needs approval: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['school_admin','super_admin']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);

  -- admin approved -> designers
  elsif new.status = 'approved' and old.status = 'pending_admin_approval' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'request_approved', new.id,
           'New request to design: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['designer']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);

  -- admin sent back to draft -> creator
  elsif new.status = 'draft' and old.status = 'pending_admin_approval' then
    v_body := 'Your draft was sent back: ' || v_title;
    if v_feedback is not null and v_feedback <> '' then
      v_body := v_body || ' — "' || v_feedback || '"';
    end if;
    if new.created_by is not null
       and new.created_by <> coalesce(v_actor, v_nil) then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body, feedback)
      values (new.created_by, v_actor, 'request_sent_back_to_draft', new.id,
              v_body, v_feedback);
    end if;

  -- designer uploaded -> school_admin(s) + super_admin(s)
  elsif new.status = 'design_pending_approval' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'design_uploaded_for_review', new.id,
           'Design ready to review: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id, array['school_admin','super_admin']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);

  -- admin approved design -> assigned designer
  elsif new.status = 'in_design' and old.status = 'design_pending_approval' then
    if new.assigned_designer_id is not null
       and new.assigned_designer_id <> coalesce(v_actor, v_nil) then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      values (new.assigned_designer_id, v_actor, 'design_approved', new.id,
              'Design approved, ready to publish: ' || v_title);
    end if;

  -- admin requested design changes -> assigned designer
  elsif new.status = 'changes_requested' then
    v_body := 'Changes requested on: ' || v_title;
    if v_feedback is not null and v_feedback <> '' then
      v_body := v_body || ' — "' || v_feedback || '"';
    end if;
    if new.assigned_designer_id is not null
       and new.assigned_designer_id <> coalesce(v_actor, v_nil) then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body, feedback)
      values (new.assigned_designer_id, v_actor, 'design_changes_requested', new.id,
              v_body, v_feedback);
    end if;

  -- published -> school_admins + decision_makers + creator
  elsif new.status = 'published' then
    insert into public.notifications (recipient_id, actor_id, type, request_id, body)
    select sm.user_id, v_actor, 'request_published', new.id,
           'Published: ' || v_title
    from public.school_member_ids_with_roles(
           new.school_id,
           array['school_admin','decision_maker']::public.user_role[]) sm(user_id)
    where sm.user_id <> coalesce(v_actor, v_nil);
    -- also notify the creator if they're not in the roles above
    if new.created_by is not null
       and new.created_by <> coalesce(v_actor, v_nil)
       and not exists (
         select 1 from public.notifications
         where request_id = new.id
           and recipient_id = new.created_by
           and type = 'request_published'
           and created_at > now() - interval '1 minute'
       ) then
      insert into public.notifications (recipient_id, actor_id, type, request_id, body)
      values (new.created_by, v_actor, 'request_published', new.id,
              'Your request is live: ' || v_title);
    end if;
  end if;

  -- Clear the transient feedback after the trigger has read it
  if new.change_feedback is not null then
    new.change_feedback := null;
  end if;

  return new;
end;
$$;
