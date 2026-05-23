-- Add email column to profiles so the app can display a fallback when
-- full_name is empty (fixes the "Someone" / "A team member" issue).

alter table public.profiles add column if not exists email text;

-- Backfill existing profiles from auth.users.
update public.profiles p
  set email = u.email
from auth.users u
where u.id = p.id
  and p.email is null;

-- Update the trigger that creates profiles on signup to also copy email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email
  );
  return new;
end;
$$;
