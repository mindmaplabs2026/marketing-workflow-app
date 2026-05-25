-- Add request type (category) and due date fields.

create type public.request_type as enum (
  'social_post',
  'poster',
  'newsletter',
  'video',
  'other'
);

alter table public.requests
  add column if not exists request_type public.request_type,
  add column if not exists due_date date;
