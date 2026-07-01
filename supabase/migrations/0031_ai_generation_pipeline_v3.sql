-- 0031: add Local AI v3 composition-agent pipeline variant.

alter table public.ai_generation_jobs
  drop constraint if exists ai_generation_jobs_pipeline_version_check;

alter table public.ai_generation_jobs
  add constraint ai_generation_jobs_pipeline_version_check
  check (pipeline_version in ('v1', 'v2', 'v3'));
