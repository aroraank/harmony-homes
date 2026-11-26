-- Run after migration 20261119000003 on a database that already has the core schema and a user.
\set ON_ERROR_STOP on
begin;
do $$
declare u uuid; r jsonb;
begin
  select id into u from public.profiles limit 1;
  if u is null then raise exception 'TEST FAIL: need one profile in the fixture'; end if;
  insert into public.notifications(user_id, kind, title, created_at, push_status) values
    (u, 't_old_sent',    'old',            now() - interval '121 days', 'sent'),
    (u, 't_old_none',    'old read',       now() - interval '200 days', 'none'),
    (u, 't_old_pending', 'old unsent',     now() - interval '150 days', 'pending'),
    (u, 't_edge',        'just inside',    now() - interval '119 days', 'sent'),
    (u, 't_new',         'new',            now(),                       'sent');
  r := public.purge_old_notifications(120);
  if (r ->> 'deleted')::int <> 2 then raise exception 'TEST FAIL: expected 2 deleted, got %', r; end if;
  if exists (select 1 from public.notifications where kind in ('t_old_sent','t_old_none')) then raise exception 'TEST FAIL: old rows remain'; end if;
  if (select count(*) from public.notifications where kind in ('t_old_pending','t_edge','t_new')) <> 3 then raise exception 'TEST FAIL: kept rows were deleted'; end if;
  begin perform public.purge_old_notifications(5); raise exception 'TEST FAIL: tiny retention allowed';
  exception when sqlstate 'P0001' then null; end;
  raise notice 'ALL purge checks passed';
end $$;
rollback;
