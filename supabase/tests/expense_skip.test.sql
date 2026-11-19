-- Harmony Homes — tests for the guard-salary re-open and the new skip rules (migration 20261119000001).
-- Run on a scratch/local database that has all earlier migrations and the seed loaded, never on production:
--   psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/expense_skip.test.sql
-- It replaces public.ist_today() with a fixed clock in that scratch database so the 15th-of-month rule can be tested.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

select id as soc from public.societies where slug = 'plot-colony' \gset
select id as fund from public.funds where society_id = :'soc' and kind = 'general' \gset
select id as u1 from public.units where society_id = :'soc' and code = 'P1-GF' \gset
select gen_random_uuid() as sa \gset
select gen_random_uuid() as ad \gset
select gen_random_uuid() as r1 \gset
insert into auth.users (id, instance_id, aud, role, email) values
 (:'sa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','es-sa@plot-colony.local'),
 (:'ad','00000000-0000-0000-0000-000000000000','authenticated','authenticated','es-ad@plot-colony.local'),
 (:'r1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','es-p1@plot-colony.local');
insert into public.profiles (id, full_name, phone) values
 (:'sa','ES Super','9876502000'), (:'ad','ES Admin','9876502001'), (:'r1','ES One','9876502002');
insert into public.memberships (user_id, society_id, unit_id, role, status) values
 (:'sa', :'soc', null, 'super_admin', 'active'), (:'ad', :'soc', null, 'admin', 'active'),
 (:'r1', :'soc', :'u1', 'resident', 'active');

\set as_ad 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''ad'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r1 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r1'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_owner 'reset role; select set_config(''request.jwt.claims'', '''', false);'

create table public._es (k text primary key, v text);
grant select on public._es to authenticated;
insert into public._es values ('soc', :'soc'), ('ad', :'ad'), ('sa', :'sa'), ('r1', :'r1');
create or replace function public._esv(p text) returns uuid language sql stable as $$ select v::uuid from public._es where k = p $$;
grant execute on function public._esv(text) to authenticated;
create or replace function public._chk(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception using errcode = 'TF001', message = 'TEST FAIL: ' || p_msg; end if; end $$;
grant execute on function public._chk(boolean, text) to authenticated;

-- fixed clock: 10 November 2026
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select date '2026-11-10' $$;

-- the live situation: November's guard salary was skipped by an admin on 1 Nov
insert into public.expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode)
values (:'soc', 'Security guard salary', :'fund', 'salary', 'Guard', 1500000, 1, 'upi') returning id as tpl \gset
insert into public.expense_drafts (society_id, template_id, period, amount_paise, status, resolved_by, resolved_at)
values (:'soc', :'tpl', '2026-10', 1500000, 'confirmed', :'ad', now()), (:'soc', :'tpl', '2026-11', 1500000, 'skipped', :'ad', now());
select id as d_nov from public.expense_drafts where template_id = :'tpl' and period = '2026-11' \gset
select id as d_oct from public.expense_drafts where template_id = :'tpl' and period = '2026-10' \gset
insert into public._es values ('d', :'d_nov');
delete from public.notifications;

\echo '1. The migration re-opens November and tells the admins'
\ir ../migrations/20261119000001_reopen_guard_salary_skip_rules.sql
select public._chk((select status from public.expense_drafts where id = :'d_nov') = 'pending', 'November is pending again');
select public._chk((select resolved_by from public.expense_drafts where id = :'d_nov') is null, 'resolver cleared');
select public._chk((select status from public.expense_drafts where id = :'d_oct') = 'confirmed', 'October untouched');
select public._chk((select count(*) from public.notifications where kind = 'expense_drafts' and user_id in (public._esv('ad'), public._esv('sa'))) = 2, 'admin and super admin notified');
select public._chk((select count(*) from public.notifications where kind = 'expense_drafts' and user_id = public._esv('r1')) = 0, 'residents not notified of the re-open');
\ir ../migrations/20261119000001_reopen_guard_salary_skip_rules.sql
select public._chk((select count(*) from public.notifications where kind = 'expense_drafts') = 2, 'running it again changes nothing');

\echo '2. Skip rules'
:as_r1
do $$ declare d uuid; begin d := public._esv('d');
  begin perform public.skip_expense_draft(d, 'Not enough money collected'); perform public._chk(false, 'resident must not skip');
  exception when sqlstate '42501' then null; end; end $$;
:as_ad
do $$ declare d uuid; begin d := public._esv('d');
  begin perform public.skip_expense_draft(d, '  '); perform public._chk(false, 'a reason is required');
  exception when sqlstate 'P0001' then null; end;
  begin perform public.skip_expense_draft(d, 'abc'); perform public._chk(false, 'a short reason is rejected');
  exception when sqlstate 'P0001' then null; end;
  perform public._chk((select status from public.expense_drafts where id = d) = 'pending', 'still pending after rejected skips');
end $$;
-- the 15th: skipping works on the 15th and stops on the 16th
:as_owner
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select date '2026-11-16' $$;
:as_ad
do $$ declare d uuid; begin d := public._esv('d');
  begin perform public.skip_expense_draft(d, 'Not enough money collected yet'); perform public._chk(false, 'skip is blocked after the 15th');
  exception when sqlstate 'P0001' then null; end;
  perform public._chk((select status from public.expense_drafts where id = d) = 'pending', 'still pending after the 15th');
end $$;
:as_owner
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select date '2026-11-15' $$;
delete from public.notifications;
:as_ad
do $$ declare d uuid; begin d := public._esv('d');
  perform public.skip_expense_draft(d, 'Not enough money collected yet');
  perform public._chk((select status from public.expense_drafts where id = d) = 'skipped', 'skip works on the 15th with a reason');
end $$;
:as_owner
select public._chk((select count(*) from public.notifications where kind = 'expense_skipped') = (select count(distinct user_id) from public.notifications where kind = 'expense_skipped')
                    and (select count(*) from public.notifications where kind = 'expense_skipped' and user_id in (public._esv('ad'), public._esv('sa'), public._esv('r1'))) = 3,
                   'every member including admins is told');
select public._chk((select count(*) from public.audit_log where action = 'expense_draft_skipped') = 1, 'skip recorded in the audit log');

\echo '3. Re-open after a skip'
:as_r1
do $$ declare d uuid; begin d := public._esv('d');
  begin perform public.reopen_expense_draft(d); perform public._chk(false, 'resident must not re-open'); exception when sqlstate '42501' then null; end; end $$;
:as_ad
do $$ declare d uuid; begin d := public._esv('d');
  perform public.reopen_expense_draft(d);
  perform public._chk((select status from public.expense_drafts where id = d) = 'pending', 'admin can re-open a skipped payment');
  begin perform public.reopen_expense_draft(d); perform public._chk(false, 'cannot re-open a pending one'); exception when sqlstate 'P0001' then null; end;
end $$;
-- a past month cannot be skipped
:as_owner
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select date '2026-12-02' $$;
:as_ad
do $$ declare d uuid; begin d := public._esv('d');
  begin perform public.skip_expense_draft(d, 'Not enough money collected yet'); perform public._chk(false, 'an older month cannot be skipped');
  exception when sqlstate 'P0001' then null; end; end $$;

\echo 'ALL expense skip checks passed'
:as_owner
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
drop function public._chk(boolean, text);
drop function public._esv(text);
drop table public._es;
