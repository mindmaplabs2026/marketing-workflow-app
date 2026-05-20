-- =============================================================
-- Phase 1 — Row Level Security + Storage
-- =============================================================
-- Run AFTER 0001_initial_schema.sql.
--
-- Policy strategy:
--   - super_admin: full access everywhere
--   - school_admin / teacher / decision_maker: scoped to schools they belong to (via school_members)
--   - designer: scoped to schools they are assigned to (also via school_members)
--   - decision_maker: read-only, and only to PUBLISHED requests + calendar
--
-- Helper functions defined in 0001:
--   public.current_user_role()       → user_role enum
--   public.is_super_admin()          → boolean
--   public.is_member_of_school(uuid) → boolean
-- =============================================================


-- -------------------------------------------------------------
-- Enable RLS on every public table.
-- =============================================================

alter table public.schools          enable row level security;
alter table public.profiles         enable row level security;
alter table public.school_members   enable row level security;
alter table public.requests         enable row level security;
alter table public.request_uploads  enable row level security;
alter table public.designs          enable row level security;
alter table public.calendar_items   enable row level security;
alter table public.published_links  enable row level security;


-- =============================================================
-- profiles
-- =============================================================
-- Everyone authenticated can read profiles (we need names/roles
-- for UI like "assigned to Designer X"). Profiles don't hold secrets.

create policy "profiles_select_all_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- A user can update their own profile (full_name).
-- A trigger below blocks self-elevation of the `role` column.
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_update_any_as_super_admin"
  on public.profiles for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Block non-super-admins from changing their own role.
create or replace function public.prevent_role_self_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role is distinct from new.role and not public.is_super_admin() then
    raise exception 'Only a super_admin can change a user role';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_self_change
  before update on public.profiles
  for each row execute function public.prevent_role_self_change();


-- =============================================================
-- schools
-- =============================================================

create policy "schools_select_for_members"
  on public.schools for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_member_of_school(id)
  );

create policy "schools_write_super_admin_only"
  on public.schools for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- =============================================================
-- school_members
-- =============================================================

create policy "school_members_select_visible_schools"
  on public.school_members for select
  to authenticated
  using (
    public.is_super_admin()
    or user_id = auth.uid()
    or public.is_member_of_school(school_id)
  );

create policy "school_members_write_super_admin_only"
  on public.school_members for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- =============================================================
-- requests
-- =============================================================
-- SELECT — three policies stack via OR:

create policy "requests_select_super_admin"
  on public.requests for select
  to authenticated
  using (public.is_super_admin());

-- Members (school_admin / teacher / designer assigned here) see ALL requests in their school.
create policy "requests_select_school_member"
  on public.requests for select
  to authenticated
  using (
    public.is_member_of_school(school_id)
    and public.current_user_role() <> 'decision_maker'
  );

-- Decision makers see ONLY published requests in their school.
create policy "requests_select_decision_maker_published_only"
  on public.requests for select
  to authenticated
  using (
    public.current_user_role() = 'decision_maker'
    and status = 'published'
    and public.is_member_of_school(school_id)
  );

-- INSERT — teacher / school_admin in the school, or super_admin.
create policy "requests_insert_school_writers"
  on public.requests for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_super_admin()
      or (
        public.is_member_of_school(school_id)
        and public.current_user_role() in ('teacher', 'school_admin')
      )
    )
  );

-- UPDATE — super_admin, school members (admin / teacher / designer), but not decision_makers.
create policy "requests_update_school_workers"
  on public.requests for update
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_member_of_school(school_id)
      and public.current_user_role() in ('school_admin', 'teacher', 'designer')
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_member_of_school(school_id)
      and public.current_user_role() in ('school_admin', 'teacher', 'designer')
    )
  );

-- DELETE — super_admin only. Everyone else archives via status update.
create policy "requests_delete_super_admin_only"
  on public.requests for delete
  to authenticated
  using (public.is_super_admin());


-- =============================================================
-- request_uploads
-- =============================================================

create policy "request_uploads_select_via_request"
  on public.request_uploads for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = request_uploads.request_id
        and public.is_member_of_school(r.school_id)
    )
  );

create policy "request_uploads_insert_via_request"
  on public.request_uploads for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = request_uploads.request_id
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() in ('teacher', 'school_admin', 'designer')
      )
    )
  );

create policy "request_uploads_delete_super_admin_or_owner"
  on public.request_uploads for delete
  to authenticated
  using (
    public.is_super_admin()
    or uploaded_by = auth.uid()
  );


-- =============================================================
-- designs
-- =============================================================

create policy "designs_select_via_request"
  on public.designs for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = designs.request_id
        and public.is_member_of_school(r.school_id)
        and public.current_user_role() <> 'decision_maker'
    )
  );

-- Only designers assigned to that school can upload designs.
create policy "designs_insert_designer_only"
  on public.designs for insert
  to authenticated
  with check (
    uploaded_by = auth.uid()
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = designs.request_id
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() = 'designer'
      )
    )
  );

create policy "designs_delete_super_admin_or_owner"
  on public.designs for delete
  to authenticated
  using (
    public.is_super_admin()
    or uploaded_by = auth.uid()
  );


-- =============================================================
-- calendar_items
-- =============================================================

create policy "calendar_items_select_via_school"
  on public.calendar_items for select
  to authenticated
  using (
    public.is_super_admin()
    or public.is_member_of_school(school_id)
  );

-- Only designers / super_admins create calendar plan items.
create policy "calendar_items_insert_design_team"
  on public.calendar_items for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_super_admin()
      or (
        public.is_member_of_school(school_id)
        and public.current_user_role() = 'designer'
      )
    )
  );

-- Designers + school_admins can update items in their school
-- (designers tweak plans; school_admins approve / give feedback).
create policy "calendar_items_update_internal_or_admin"
  on public.calendar_items for update
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_member_of_school(school_id)
      and public.current_user_role() in ('designer', 'school_admin')
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.is_member_of_school(school_id)
      and public.current_user_role() in ('designer', 'school_admin')
    )
  );

create policy "calendar_items_delete_super_admin_only"
  on public.calendar_items for delete
  to authenticated
  using (public.is_super_admin());


-- =============================================================
-- published_links
-- =============================================================

create policy "published_links_select_via_request"
  on public.published_links for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = published_links.request_id
        and public.is_member_of_school(r.school_id)
        -- Decision makers CAN see published links (they're the read-only audience).
    )
  );

-- Only the assigned designer (or super_admin) can paste live links.
create policy "published_links_insert_designer_only"
  on public.published_links for insert
  to authenticated
  with check (
    posted_by = auth.uid()
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = published_links.request_id
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() = 'designer'
      )
    )
  );

create policy "published_links_delete_super_admin_only"
  on public.published_links for delete
  to authenticated
  using (public.is_super_admin());


-- =============================================================
-- Storage buckets
-- =============================================================
-- Two private buckets. Path convention: <request_id>/<filename>.
-- Storage policies extract request_id from the first folder segment
-- and defer to the parent request's school_id for access checks.

insert into storage.buckets (id, name, public)
values ('request-uploads', 'request-uploads', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('designs', 'designs', false)
on conflict (id) do nothing;


-- ---------- request-uploads bucket ----------

create policy "storage_request_uploads_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'request-uploads'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = ((storage.foldername(name))[1])::uuid
          and public.is_member_of_school(r.school_id)
      )
    )
  );

create policy "storage_request_uploads_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'request-uploads'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = ((storage.foldername(name))[1])::uuid
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() in ('teacher', 'school_admin', 'designer')
      )
    )
  );

create policy "storage_request_uploads_delete_owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'request-uploads'
    and (public.is_super_admin() or owner = auth.uid())
  );


-- ---------- designs bucket ----------

create policy "storage_designs_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'designs'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = ((storage.foldername(name))[1])::uuid
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() <> 'decision_maker'
      )
    )
  );

create policy "storage_designs_insert_designer_only"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'designs'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = ((storage.foldername(name))[1])::uuid
          and public.is_member_of_school(r.school_id)
          and public.current_user_role() = 'designer'
      )
    )
  );

create policy "storage_designs_delete_owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'designs'
    and (public.is_super_admin() or owner = auth.uid())
  );
