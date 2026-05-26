-- Comments RLS: let super_admins read and write comments on any request,
-- mirroring how the requests table already lets super_admins see everything.
-- Previously only formal school_members could read/insert comments, which
-- hid comments from super_admins viewing requests outside their school memberships.

drop policy if exists "comments_select" on public.comments;
create policy "comments_select"
  on public.comments for select
  to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.requests r
      where r.id = comments.request_id
        and public.is_member_of_school(r.school_id)
    )
  );

drop policy if exists "comments_insert" on public.comments;
create policy "comments_insert"
  on public.comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.current_user_role() <> 'decision_maker'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where r.id = comments.request_id
          and public.is_member_of_school(r.school_id)
      )
    )
  );
