-- =============================================================
-- Follow-up — Calendar feedback note
-- =============================================================
-- Clarity-doc: "School admin reviews calendar and provides feedback."
-- A free-text note the school_admin can leave when cancelling
-- (or, less common, approving) a planned item. The designer
-- drafting the next round sees it on the cancelled item.
--
-- Apply AFTER 0005 in the Supabase SQL editor.
-- =============================================================

alter table public.calendar_items
  add column if not exists feedback text;
