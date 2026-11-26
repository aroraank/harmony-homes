-- 2026-11-26: push notifications must reach a device within seconds, not minutes, and must not depend on
-- whoever triggered the notification still being online.
--
-- Root cause of "notification doesn't arrive when my app is closed": delivery only ever happened two ways --
-- (a) the ACTING device's own browser calling push-dispatch itself, 800ms after the action (nudgePush() in
--     lib/push.ts), or (b) a pg_cron job hitting push-dispatch every 5 MINUTES as a fallback.
-- Path (a) depends entirely on the guard's/admin's own phone being online and that one HTTP call succeeding
-- at that instant -- if it's flaky, or the browser throttles a background timer, nothing is sent until the
-- 5-minute fallback. That is the live-test symptom: it worked when watched closely (app open, foreground,
-- network fine) and silently failed otherwise.
--
-- Fix: the database itself now fires the push the instant a notification row is created, from inside
-- Postgres, via pg_net (async, does not block or slow down the action that created the notification).
-- This no longer depends on ANY client being open or online -- not the recipient's, not the sender's.
-- Safe to run more than once.

create extension if not exists pg_net;

create or replace function public._trigger_push_dispatch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Fire-and-forget: pg_net queues this and returns immediately, so it adds no latency to whatever
  -- action (gate check-in, payment, notice, etc.) just created the notification row(s).
  perform net.http_post(
    url := 'https://aklchxzpfiuqrwzehqig.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'c1b61a2fe3481fa7aadcd08d83bd72616ea5526a84e48d87'),
    body := '{}'::jsonb
  );
  return null;
end $$;

-- One call per INSERT statement, not per row -- a single action (e.g. "notify every member") can create
-- many notification rows at once; one push-dispatch call already drains the whole batch (it claims up to
-- 100 rows x 3 rounds per call).
drop trigger if exists notifications_push_dispatch on public.notifications;
create trigger notifications_push_dispatch
  after insert on public.notifications
  for each statement
  execute function public._trigger_push_dispatch();
