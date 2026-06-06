-- =============================================================
-- 0021 — School-specific AI guidelines
-- =============================================================
-- Free-text instructions per school that get passed to the AI
-- creative agent before it designs posters. Covers school-specific
-- rules like "always include both logos", "use Kannada tagline",
-- "primary colors are navy and gold", etc.
-- =============================================================

alter table public.schools
  add column ai_guidelines text;
