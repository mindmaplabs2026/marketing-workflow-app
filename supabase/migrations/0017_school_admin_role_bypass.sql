-- =============================================================
-- 0017 — Let service-role bypass prevent_role_self_change
-- =============================================================
-- The Add-User flow now creates users via admin.auth.admin.createUser
-- and then updates their profile (role + password_set) using the
-- service-role client, because school_admin callers cannot satisfy
-- the profiles_update_any_as_super_admin RLS policy.
--
-- The existing trigger blocks any role change unless is_super_admin()
-- is true. Under service-role, auth.uid() is null and is_super_admin()
-- returns false, so the trigger would reject the legitimate role
-- assignment that immediately follows a createUser call.
--
-- Service-role is server-side only (gated behind the Supabase service
-- role key in the Next.js server action), so we let it through. The
-- trigger still blocks every authenticated role from changing its own
-- role, which is the property we care about.
-- =============================================================

create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if old.role is distinct from new.role and not public.is_super_admin() then
    raise exception 'Only a super_admin can change a user role';
  end if;
  return new;
end;
$$;
