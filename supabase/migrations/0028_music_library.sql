-- 0028: Permanent music library
--
-- Archives royalty-free tracks discovered from Pixabay into a bounded, reusable
-- library (files live in the `music-library` storage bucket). Each track is keyed
-- by a content hash (dedupe — the same track is never stored twice) and tagged by
-- mood so the curated-library fallback can pick from it. The library is bounded
-- per-mood with least-frequently-used eviction enforced in app code, so storage
-- stays capped at roughly (#moods × MUSIC_LIBRARY_MAX_PER_MOOD) tracks.

create table if not exists public.music_library (
  id            uuid primary key default gen_random_uuid(),
  -- Human-facing short code (first 12 hex chars of the content hash).
  code          text not null unique,
  -- Full sha256 of the file bytes — the dedupe key.
  content_hash  text not null unique,
  -- Path within the `music-library` bucket, e.g. "upbeat/<code>.mp3".
  storage_path  text not null,
  -- Primary mood folder this track is filed under.
  mood          text not null,
  -- All mood keywords from the request that discovered it.
  mood_keywords text[] not null default '{}',
  tempo         text,
  source        text not null default 'pixabay',
  duration_sec  real,
  file_size     bigint,
  -- Usage stats drive least-frequently-used eviction.
  times_used    integer not null default 1,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index if not exists music_library_mood_idx on public.music_library (mood);
create index if not exists music_library_content_hash_idx on public.music_library (content_hash);

-- RLS: this is an internal, backend-only catalog. The worker accesses it via the
-- service-role key, which bypasses RLS, so it keeps working with NO policies.
-- Enabling RLS with no policies denies all anon/authenticated access — nobody with
-- the public anon key can read or write it through PostgREST. (No per-school policies
-- like the other AI tables, because no client reads this table directly.)
alter table public.music_library enable row level security;
