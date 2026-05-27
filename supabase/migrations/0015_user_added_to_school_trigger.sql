-- Fan out a notification whenever someone is added to a school. Works for
-- every membership path: the admin/users invite flow, the admin/schools
-- "add member" form, and any future programmatic insert. The recipient is
-- the user who was added; the actor is whichever admin (auth.uid()) ran
-- the insert. Skip the no-op case where someone somehow adds themselves.

create or replace function public.notify_on_school_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_nil         uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_school_name text;
begin
  if new.user_id = coalesce(v_actor, v_nil) then
    return new;
  end if;

  select name
    into v_school_name
    from public.schools
   where id = new.school_id;

  insert into public.notifications
    (recipient_id, actor_id, type, body)
  values
    (new.user_id,
     v_actor,
     'user_added_to_school',
     'You were added to ' || coalesce(v_school_name, 'a school'));

  return new;
end;
$$;

create trigger school_members_notify
  after insert on public.school_members
  for each row execute function public.notify_on_school_member_added();
