-- School administrators can draft calendar items for schools they belong to.
-- Super administrators retain global access; designers retain their existing
-- member-school access.

drop policy if exists "calendar_items_insert_design_team" on public.calendar_items;

create policy "calendar_items_insert_design_team_or_school_admin"
  on public.calendar_items for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_super_admin()
      or (
        public.is_member_of_school(school_id)
        and public.current_user_role() in ('designer', 'school_admin')
      )
    )
  );
