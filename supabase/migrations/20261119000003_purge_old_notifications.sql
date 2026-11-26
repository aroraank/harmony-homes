-- 2026-11-19 (part 3): keep the notifications table from growing forever.
-- Every announcement writes one row per member, so this table is the fastest-growing one. Anything
-- older than 120 days is deleted, once a day. A notification still waiting to be pushed to a phone is
-- never deleted, whatever its age. Kept as its own small job on purpose, so it cannot be lost when
-- run_daily_jobs() is redefined by a later migration.

create or replace function public.purge_old_notifications(p_keep_days int default 120) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_keep_days < 30 then raise exception using errcode = 'P0001', message = 'Keep at least 30 days.'; end if;
  delete from public.notifications
   where created_at < now() - make_interval(days => p_keep_days)
     and push_status not in ('pending', 'sending');
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end $$;
revoke execute on function public.purge_old_notifications(int) from public, anon, authenticated;
grant execute on function public.purge_old_notifications(int) to service_role;

-- Every day at 03:00 IST (21:30 UTC). pg_cron replaces the job when the name already exists.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('hh-purge-notifications', '30 21 * * *', $c$ select public.purge_old_notifications(120); $c$);
  end if;
end $$;
