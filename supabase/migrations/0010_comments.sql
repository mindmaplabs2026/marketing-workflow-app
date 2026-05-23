-- =============================================================
-- Comments — per-request threaded conversation
-- =============================================================
-- Replaces the need for WhatsApp threads. Any school member
-- (teacher, school_admin, designer, super_admin) can comment
-- on a request they can see. Decision makers cannot comment
-- (they can't see requests).

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.requests(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index comments_request_idx on public.comments (request_id, created_at asc);

-- RLS
alter table public.comments enable row level security;

-- Anyone who can see the request can read its comments.
create policy "comments_select"
  on public.comments for select
  to authenticated
  using (
    exists (
      select 1 from public.requests r
      where r.id = comments.request_id
        and public.is_member_of_school(r.school_id)
    )
  );

-- Any authenticated school member (except decision_maker) can insert.
create policy "comments_insert"
  on public.comments for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.current_user_role() <> 'decision_maker'
    and exists (
      select 1 from public.requests r
      where r.id = comments.request_id
        and public.is_member_of_school(r.school_id)
    )
  );
