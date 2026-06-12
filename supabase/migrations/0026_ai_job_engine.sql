-- 0026: engine tag on ai_generation_jobs (two coexisting buttons)
--
--   'cloud' = existing path → Inngest + OpenAI  ("Generate with AI")
--   'local' = new path      → Codex worker      ("Generate with Local AI")
--
-- Replaces the global POSTER_ENGINE switch with a per-job choice, so both
-- buttons run side by side. Backward-compatible: NOT NULL default 'cloud',
-- so every existing job and the current production app are unaffected.
alter table public.ai_generation_jobs
  add column if not exists engine text not null default 'cloud'
  check (engine in ('cloud', 'local'));
