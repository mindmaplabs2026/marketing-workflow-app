-- Marks whether a user has set their own password.
--
-- Defaults to true so every pre-existing profile (those seeded manually
-- through the Supabase dashboard) keeps its current behavior.
-- The inviteInternalUser server action explicitly sets this to false for
-- newly invited designers / super admins; the proxy then bounces them to
-- /setup-password until they pick a password.
alter table public.profiles
  add column password_set boolean not null default true;
