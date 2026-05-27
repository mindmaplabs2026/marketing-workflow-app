-- Add a new notification type for "you were added to a school".
-- Must be a separate migration from the trigger that uses it: Postgres
-- doesn't let you reference a newly-added enum value in the same
-- transaction that adds it.

alter type public.notification_type
  add value if not exists 'user_added_to_school';
