-- 0025: let the server worker own chat-edit redesigns (Codex Poster Bridge, Phase 3b)
--
-- In POSTER_ENGINE=server mode the chat-edit redesign ("make the logo bigger")
-- must run on our own worker instead of Inngest. The worker can't see the
-- Inngest event payload, so we persist what it needs on the user message and
-- give it a claim flag (mirrors how ai_generation_jobs.status is claimed).
--
-- Both columns are nullable → the current Inngest path (production on 'main')
-- is completely unaffected.
alter table public.ai_chat_messages
  add column if not exists status text
    check (status is null or status in ('queued', 'processing', 'done', 'failed'));

alter table public.ai_chat_messages
  add column if not exists page_index int;

-- Worker polls this: pending user messages waiting to be processed.
create index if not exists ai_chat_messages_status_idx
  on public.ai_chat_messages(status)
  where status is not null;
