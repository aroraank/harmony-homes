-- Harmony Homes — scheduled jobs (run once in the Supabase SQL editor AFTER deploying the Edge Functions).
-- Replace YOUR-PROJECT-REF and YOUR-CRON-SECRET (the same value you set as the CRON_SECRET function secret).
-- Enable the extensions first: Database → Extensions → pg_cron and pg_net (or run the two lines below).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every day at 06:05 IST (00:35 UTC): monthly dues on the 1st, recurring expense drafts, reminders, location retention.
select cron.schedule('hh-daily-jobs', '35 0 * * *', $$ select public.run_daily_jobs(); $$);

-- Safety-net only now: the database fires push-dispatch INSTANTLY on every new notification via a
-- trigger (see migration 20261126000005_instant_push_dispatch.sql) using pg_net directly -- this cron job
-- is just a catch-up in case that one HTTP call ever fails (network blip, cold start, etc.), so it only
-- needs to run once a minute, not every 5.
select cron.schedule(
  'hh-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://aklchxzpfiuqrwzehqig.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'c1b61a2fe3481fa7aadcd08d83bd72616ea5526a84e48d87'),
    body := '{}'::jsonb
  );
  $$
);

--  node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
-- To check:  select * from cron.job;   select * from cron.job_run_details order by start_time desc limit 20;
-- To remove: select cron.unschedule('hh-push-dispatch');
