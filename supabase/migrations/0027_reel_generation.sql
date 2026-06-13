-- 0027: Reel generation support
--
-- Extends the AI pipeline to support video reel generation via Remotion.
-- Adds 'reel' as a poster_type, 'music' as a job status, and reel-specific
-- columns on ai_generation_jobs.

-- 1. Extend poster_type on ai_generation_jobs to include 'reel'.
--    The inline CHECK from 0024 must be dropped first.
alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_poster_type_check;
alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_poster_type_check
  check (poster_type in ('single', 'carousel', 'reel'));

-- 2. Extend poster_type on ai_variations to include 'reel'.
alter table public.ai_variations
  drop constraint if exists ai_variations_poster_type_check;
alter table public.ai_variations
  add constraint ai_variations_poster_type_check
  check (poster_type in ('single', 'carousel', 'reel'));

-- 3. Reel-specific columns on ai_generation_jobs.
alter table public.ai_generation_jobs
  add column if not exists reel_duration_sec smallint,
  add column if not exists music_metadata jsonb;

-- 4. New job status for the music discovery step.
--    Enum values are append-only; 'music' sits logically between 'creative'
--    and 'generating' but Postgres enums don't enforce ordering.
alter type public.ai_job_status add value if not exists 'music';
