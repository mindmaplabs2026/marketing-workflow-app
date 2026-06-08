-- =============================================================
-- 0023 — Deduplicate request_uploads and enforce uniqueness
-- =============================================================
-- request_uploads had no UNIQUE constraint on (request_id,
-- storage_path), so a double-fired attachUpload() server action
-- could insert two rows pointing at the same file. That broke
-- the feed (duplicate React keys) and showed the same thumbnail
-- twice.
--
-- This migration:
--   1. Removes existing duplicates, keeping the oldest row per
--      (request_id, storage_path).
--   2. Adds UNIQUE (request_id, storage_path) so duplicates
--      cannot happen again at the DB level.
-- =============================================================

delete from public.request_uploads a
using public.request_uploads b
where a.ctid > b.ctid
  and a.request_id   = b.request_id
  and a.storage_path = b.storage_path;

alter table public.request_uploads
  add constraint request_uploads_request_path_unique
  unique (request_id, storage_path);
