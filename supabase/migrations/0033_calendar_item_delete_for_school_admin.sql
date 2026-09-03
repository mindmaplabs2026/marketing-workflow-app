-- Allow school administrators to delete calendar items in schools they manage.
-- Super administrators retain global delete access. Application code refuses
-- deletion of items already linked to a request so the workflow is not orphaned.

drop policy if exists "calendar_items_delete_super_admin_only" on public.calendar_items;

create policy "calendar_items_delete_super_admin_or_school_admin"
  on public.calendar_items for delete
  to authenticated
  using (
    public.is_super_admin()
    or (
      public.current_user_role() = 'school_admin'
      and public.is_member_of_school(school_id)
    )
  );
