-- 0030: distinguish local AI pipeline variants.
--
-- v1 is the original local/Codex path: the image model receives uploaded photos
-- as editable references and generates the full poster.
-- v2 preserves uploaded photos by generating only the designed background and
-- compositing the original photo pixels afterward in the worker.

alter table public.ai_generation_jobs
  add column if not exists pipeline_version text not null default 'v1'
  check (pipeline_version in ('v1', 'v2'));
