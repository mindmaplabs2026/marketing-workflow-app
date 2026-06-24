-- 0029: AI generation notifications go to internal members only
--
-- AI generation is an internal MindMap tool. The original trigger (0020) sent
-- 'ai_generation_completed' / 'ai_generation_failed' notifications to the request
-- CREATOR (v_request.created_by) — a school-side user (teacher / school_admin) —
-- with body text like "AI posters ready for review", leaking the fact that a
-- design was AI-generated to external members.
--
-- Redirect these notifications to the request's ASSIGNED DESIGNER (the internal
-- member who triggered/owns the generation). If no designer is assigned, no
-- notification is created. The school side only ever learns about the *design*
-- via the existing design-review flow, never about AI.

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

  select r.title, r.assigned_designer_id, r.school_id
  into v_request
  from public.requests r
  where r.id = new.request_id;

  if v_request is null then return new; end if;
  -- Internal-only: without an assigned designer there is no internal recipient.
  if v_request.assigned_designer_id is null then return new; end if;

  if new.status = 'completed' then
    insert into public.notifications (recipient_id, type, request_id, body)
    values (
      v_request.assigned_designer_id,
      'ai_generation_completed',
      new.request_id,
      'AI posters ready for review: ' || coalesce(v_request.title, 'a request')
    );

  elsif new.status = 'failed' then
    insert into public.notifications (recipient_id, type, request_id, body)
    values (
      v_request.assigned_designer_id,
      'ai_generation_failed',
      new.request_id,
      'AI generation failed for: ' || coalesce(v_request.title, 'a request')
    );
  end if;

  return new;
end;
$$;

-- One-time cleanup: remove AI notifications already delivered to external members
-- (anyone who isn't an internal super_admin / designer) under the old behavior,
-- so they disappear from school-side notification bells.
delete from public.notifications n
using public.profiles p
where n.recipient_id = p.id
  and n.type in ('ai_generation_completed', 'ai_generation_failed')
  and p.role not in ('super_admin', 'designer');
