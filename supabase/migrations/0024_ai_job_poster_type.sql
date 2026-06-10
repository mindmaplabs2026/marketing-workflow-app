-- 0024: poster_type on ai_generation_jobs (Codex Poster Bridge)
--
-- The standalone server worker (POSTER_ENGINE=server) reads the job row to
-- learn whether to make a 'single' poster or a 'carousel'. Today that value
-- only travels in the Inngest event payload, which the worker never sees, so
-- we persist it on the job.
--
-- Backward-compatible: NOT NULL with default 'single', so existing code paths
-- that insert a job without poster_type (e.g. the current production app on
-- 'main') keep working unchanged.
alter table public.ai_generation_jobs
  add column if not exists poster_type text not null default 'single'
  check (poster_type in ('single', 'carousel'));
