-- =============================================================
-- 0018 — Storage path now includes school_id
-- =============================================================
-- Old layout:  <request_id>/<file>
-- New layout:  <school_id>/<request_id>/<file>
--
-- This migration is TRANSITIONAL — RLS accepts both layouts so
-- existing files keep working until scripts/backfill-storage-paths.mjs
-- runs. A follow-up migration can drop the old branch after backfill.
-- =============================================================


-- ---------- request-uploads bucket ----------

drop policy if exists "storage_request_uploads_select" on storage.objects;
create policy "storage_request_uploads_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'request-uploads'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where public.is_member_of_school(r.school_id)
          and (
            -- old layout: <request_id>/<file>
            r.id::text = (storage.foldername(name))[1]
            or (
              -- new layout: <school_id>/<request_id>/<file>
              r.school_id::text = (storage.foldername(name))[1]
              and r.id::text       = (storage.foldername(name))[2]
            )
          )
      )
    )
  );

drop policy if exists "storage_request_uploads_insert" on storage.objects;
create policy "storage_request_uploads_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'request-uploads'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where public.is_member_of_school(r.school_id)
          and public.current_user_role() in ('teacher', 'school_admin', 'designer')
          and (
            r.id::text = (storage.foldername(name))[1]
            or (
              r.school_id::text = (storage.foldername(name))[1]
              and r.id::text       = (storage.foldername(name))[2]
            )
          )
      )
    )
  );


-- ---------- designs bucket ----------

drop policy if exists "storage_designs_select" on storage.objects;
create policy "storage_designs_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'designs'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where public.is_member_of_school(r.school_id)
          and public.current_user_role() <> 'decision_maker'
          and (
            r.id::text = (storage.foldername(name))[1]
            or (
              r.school_id::text = (storage.foldername(name))[1]
              and r.id::text       = (storage.foldername(name))[2]
            )
          )
      )
    )
  );

drop policy if exists "storage_designs_insert_designer_only" on storage.objects;
create policy "storage_designs_insert_designer_only"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'designs'
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.requests r
        where public.is_member_of_school(r.school_id)
          and public.current_user_role() = 'designer'
          and (
            r.id::text = (storage.foldername(name))[1]
            or (
              r.school_id::text = (storage.foldername(name))[1]
              and r.id::text       = (storage.foldername(name))[2]
            )
          )
      )
    )
  );


-- delete policies (owner-based) are unchanged — they don't read the path.
