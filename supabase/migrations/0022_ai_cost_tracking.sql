-- Track per-job AI generation costs
alter table public.ai_generation_jobs
  add column if not exists cost_tracking jsonb default '{}';

comment on column public.ai_generation_jobs.cost_tracking is
  'Accumulated token usage and USD costs per agent stage';
