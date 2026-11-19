-- Harmony Homes — tests for the guard salary payment flow (migrations 20261119000001 + 20261119000002).
-- Run on a scratch/local database that has all earlier migrations and the seed loaded, never on production:
--   psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/guard_payment.test.sql
-- It replaces public.ist_today() with a fixed clock in that scratch database (restored at the end).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

select id as soc from public.societies where slug = 'plot-colony' \gset
select id as fund from public.funds where society_id = :'soc' and kind = 'general' \gset
select id as u1 from public.units where society_id = :'soc' and code = 'P1-GF' \gset
select id as u2 from public.units where society_id = :'soc' and code = 'P2-GF' \gset
select gen_random_uuid() as sa \gset
select gen_random_uuid() as ad \gset
select gen_random_uuid() as r1 \gset
insert into auth.users (id, instance_id, aud, role, email) values
 (:'sa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gp-sa@plot-colony.local'),
 (:'ad','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gp-ad@plot-colony.local'),
 (:'r1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','gp-p1@plot-colony.local');
insert into public.profiles (id, full_name, phone) values
 (:'sa','GP Super','9876503000'), (:'ad','GP Admin','9876503001'), (:'r1','GP One','9876503002');
insert into public.memberships (user_id, society_id, unit_id, role, status) values
 (:'sa', :'soc', null, 'super_admin', 'active'), (:'ad', :'soc', null, 'admin', 'active'),
 (:'r1', :'soc', :'u1', 'resident', 'active');

\set as_ad 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''ad'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r1 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r1'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_owner 'reset role; select set_config(''request.jwt.claims'', '''', false);'

create table public._gp (k text primary key, v text);
grant select on public._gp to authenticated;
insert into public._gp values ('soc', :'soc'), ('ad', :'ad'), ('sa', :'sa'), ('r1', :'r1'), ('u1', :'u1'), ('u2', :'u2'), ('fund', :'fund');
create or replace function public._gv(p text) returns uuid language sql stable as $$ select v::uuid from public._gp where k = p $$;
grant execute on function public._gv(text) to authenticated;
create or replace function public._chk(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception using errcode = 'TF001', message = 'TEST FAIL: ' || p_msg; end if; end $$;
grant execute on function public._chk(boolean, text) to authenticated;
create or replace function public._clock(p date) returns void language plpgsql as $$
begin execute format('create or replace function public.ist_today() returns date language sql stable set search_path = public as $f$ select date %L $f$', p::text); end $$;

select public._clock('2026-11-10');
-- the live shape: guard salary ₹15,000 (day 1), a water bill template; Oct + Nov guard drafts as in production
insert into public.expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode)
values (:'soc', 'Security guard salary', :'fund', 'salary', 'Guard', 1500000, 1, 'upi') returning id as t_guard \gset
insert into public.expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode)
values (:'soc', 'Water tanker', :'fund', 'water', 'Tanker', 300000, 5, 'cash') returning id as t_water \gset
insert into public.expense_drafts (society_id, template_id, period, amount_paise, status, resolved_by, resolved_at)
values (:'soc', :'t_guard', '2026-11', 1500000, 'skipped', :'ad', now()),
       (:'soc', :'t_water', '2026-11', 300000, 'pending', null, null);
select id as d_guard from public.expense_drafts where template_id = :'t_guard' and period = '2026-11' \gset
select id as d_water from public.expense_drafts where template_id = :'t_water' and period = '2026-11' \gset
insert into public._gp values ('d_guard', :'d_guard'), ('d_water', :'d_water'), ('t_guard', :'t_guard'), ('t_water', :'t_water');
delete from public.notifications;

\ir ../migrations/20261119000001_reopen_guard_salary_skip_rules.sql
\ir ../migrations/20261119000002_guard_salary_payment_flow.sql
\ir ../migrations/20261119000002_guard_salary_payment_flow.sql

\echo '1. Guard salary is reopened and can never be skipped; other payments keep the 15th rule'
select public._chk((select status from public.expense_drafts where id = :'d_guard') = 'pending', 'guard salary reopened');
select public._chk(not (select skippable from public.expense_templates where id = :'t_guard'), 'guard template not skippable');
select public._chk((select skippable from public.expense_templates where id = :'t_water'), 'water template skippable');
:as_ad
do $$ begin begin perform public.skip_expense_draft(public._gv('d_guard'), 'Not enough money collected yet');
  perform public._chk(false, 'guard salary must not be skippable'); exception when sqlstate 'P0001' then
  perform public._chk(sqlerrm like '%cannot be skipped%', 'clear message: ' || sqlerrm); end; end $$;
do $$ begin perform public.skip_expense_draft(public._gv('d_water'), 'Tanker not needed this month');
  perform public._chk((select status from public.expense_drafts where id = public._gv('d_water')) = 'skipped', 'water can still be skipped'); end $$;
:as_owner
update public.expense_drafts set status = 'pending', resolved_by = null, resolved_at = null where id = :'d_water';

\echo '2. Every unpaid month for admins, oldest first, with balance and late flags'
insert into public.expense_drafts (society_id, template_id, period, amount_paise) values (:'soc', :'t_guard', '2026-12', 1500000);
:as_r1
do $$ begin begin perform public.pending_fixed_expenses(public._gv('soc')); perform public._chk(false, 'residents must not see this');
  exception when sqlstate '42501' then null; end; end $$;
:as_owner
select public._clock('2026-12-03');
:as_ad
do $$ declare r jsonb; begin
  r := public.pending_fixed_expenses(public._gv('soc'));
  perform public._chk(jsonb_array_length(r) = 3, 'three unpaid payments listed');
  perform public._chk((select x->>'period_label' from jsonb_array_elements(r) x where x->>'title' = 'Security guard salary' order by x->>'period' limit 1) = 'November 2026', 'November listed first');
  perform public._chk((select (x->>'overdue')::boolean from jsonb_array_elements(r) x where x->>'period' = '2026-11' and x->>'title' like 'Security%'), 'November marked overdue on 3 Dec');
  perform public._chk((select (x->>'late_if_paid_today')::boolean from jsonb_array_elements(r) x where x->>'period' = '2026-11' and x->>'title' like 'Security%'), 'November would be late today');
  perform public._chk(not (select (x->>'late_if_paid_today')::boolean from jsonb_array_elements(r) x where x->>'period' = '2026-12'), 'December would not be late today');
  perform public._chk(not (select (x->>'can_skip')::boolean from jsonb_array_elements(r) x where x->>'title' like 'Security%' and x->>'period' = '2026-12'), 'December guard salary cannot be skipped');
  perform public._chk((select (x->>'can_report_blocked')::boolean from jsonb_array_elements(r) x where x->>'period' = '2026-11' and x->>'title' like 'Security%'), 'can report blocked for an older month');
  perform public._chk((select (x->>'fund_id')::uuid from jsonb_array_elements(r) x limit 1) = public._gv('fund'), 'the list names the fund to pay from');
end $$;

\echo '3. Reminders also cover an older unpaid month'
:as_owner
delete from public.notifications;
select public._chk((public.remind_overdue_expenses()->>'reminders_sent')::int = 3, 'three reminders (Nov guard, Nov water, Dec guard) on 3 Dec');
select public._chk((select count(*) from public.notifications where kind = 'expense_overdue' and title like '%(November 2026)%') >= 3, 'older month named in the reminder');

\echo '4. A plain expense with no draft no longer errors'
select public._clock('2026-11-10');
insert into public.ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, note, created_by)
values (:'soc', :'fund', '2026-11-02', 'credit', 4000000, 'opening_balance', 'test opening', :'ad');
:as_ad
select public.record_expense(public._gv('fund'), 'water', 'Tanker', 50000, date '2026-11-10', 'cash', null, 'extra tanker', null, 'plain-exp-0001') \gset
do $$ begin perform public._chk(true, 'ok'); end $$;

\echo '5. On time with enough balance: normal "paid" notice'
:as_owner
delete from public.notifications;
:as_ad
select public.pay_fixed_expense(public._gv('d_water'), 300000, date '2026-11-10', 'cash', null, null, null, 'pay-water-0001', p_fund_id => public._gv('fund')) \gset
:as_owner
select public._chk((select status from public.expense_drafts where id = :'d_water') = 'confirmed', 'water draft confirmed');
select public._chk((select count(*) from public.notifications where kind = 'expense_recorded' and title like 'Water tanker paid: %') >= 3, 'everyone told it was paid');
select public._chk((select count(*) from public.notifications where kind = 'expense_recorded' and title like '%late%') = 0, 'not described as late');
select public._chk((select count(*) from public.audit_log where action = 'fixed_expense_paid') = 1, 'recorded in the audit log');

\echo '6. Late payment of November on 3 December: date chosen, everyone told the collection was late'
select public._clock('2026-12-03');
delete from public.notifications;
:as_ad
select public.pay_fixed_expense(public._gv('d_guard'), 1500000, date '2026-12-03', 'upi', 'UTR1234567890', null, null, 'pay-guard-nov-1') \gset
:as_owner
select public._chk((select status from public.expense_drafts where id = :'d_guard') = 'confirmed', 'November confirmed');
select public._chk((select entry_date from public.ledger_entries where id = (select ledger_entry_id from public.expense_drafts where id = :'d_guard')) = date '2026-12-03', 'payment date is the chosen date');
select public._chk((select count(*) from public.notifications where kind = 'expense_recorded' and title like 'Security guard salary paid late: %') >= 3, 'everyone told it was paid late');
select public._chk((select count(*) from public.notifications where kind = 'expense_recorded' and body like '%collection was late%') >= 3, 'wording says the collection was late');
select public._chk((select note from public.ledger_entries where id = (select ledger_entry_id from public.expense_drafts where id = :'d_guard')) like '%Paid late%', 'ledger note says it was late');
select public._chk((select status from public.expense_drafts where template_id = :'t_guard' and period = '2026-12') = 'pending', 'December still pending');

\echo '7. Balance short: needs extra payments or a reason'
-- bring the balance down to ₹4,000 so December (₹15,000) is ₹11,000 short
select public._clock('2026-12-03');
insert into public.ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, payee, note, created_by)
select :'soc', :'fund', '2026-12-03', 'debit', public.fund_balance_paise(:'fund') - 400000, 'salary', 'Test', 'balance trim', :'ad';
select public._chk(public.fund_balance_paise(:'fund') = 400000, 'balance is now 4,000');
select id as d_dec from public.expense_drafts where template_id = :'t_guard' and period = '2026-12' \gset
insert into public._gp values ('d_dec', :'d_dec');
:as_ad
do $$ begin begin perform public.pay_fixed_expense(public._gv('d_dec'), 1500000, date '2026-12-03', 'upi', 'UTR2222222222', null, null, 'pay-dec-0001');
  perform public._chk(false, 'must refuse when short'); exception when sqlstate 'P0001' then
  perform public._chk(sqlerrm like 'NOT_ENOUGH_BALANCE%', 'short-fall message: ' || sqlerrm); end; end $$;
-- a contribution needing a UTR but not giving one rolls everything back
do $$ begin begin perform public.pay_fixed_expense(public._gv('d_dec'), 1500000, date '2026-12-03', 'upi', 'UTR2222222222', null, null, 'pay-dec-0002', null,
    jsonb_build_array(jsonb_build_object('unit_id', public._gv('u1'), 'amount_paise', 1100000, 'payment_mode', 'upi')));
  perform public._chk(false, 'upi extra payment without UTR must fail'); exception when sqlstate 'P0001' then null; end; end $$;
-- the same flat twice is refused
do $$ begin begin perform public.pay_fixed_expense(public._gv('d_dec'), 1500000, date '2026-12-03', 'upi', 'UTR2222222222', null, null, 'pay-dec-0003', null,
    jsonb_build_array(jsonb_build_object('unit_id', public._gv('u1'), 'amount_paise', 500000, 'payment_mode', 'cash'),
                      jsonb_build_object('unit_id', public._gv('u1'), 'amount_paise', 600000, 'payment_mode', 'cash')));
  perform public._chk(false, 'same flat twice must fail'); exception when sqlstate 'P0001' then null; end; end $$;
:as_owner
select public._chk((select status from public.expense_drafts where id = :'d_dec') = 'pending', 'nothing changed after failures');
select public._chk((select count(*) from public.ledger_entries where category = 'extra_contribution') = 0, 'no extra payment saved after failures');
select public._chk(public.fund_balance_paise(:'fund') = 400000, 'balance unchanged after failures');

\echo '8. Extra payments cover the short-fall; everyone sees who added how much'
delete from public.notifications;
:as_ad
select public.pay_fixed_expense(public._gv('d_dec'), 1500000, date '2026-12-03', 'upi', 'UTR3333333333', null, null, 'pay-dec-0004', null,
  jsonb_build_array(jsonb_build_object('unit_id', public._gv('u1'), 'amount_paise', 600000, 'payment_mode', 'cash'),
                    jsonb_build_object('unit_id', public._gv('u2'), 'amount_paise', 500000, 'payment_mode', 'cash'))) as r \gset
:as_owner
select public._chk((select status from public.expense_drafts where id = :'d_dec') = 'confirmed', 'December confirmed');
select public._chk((select count(*) from public.ledger_entries where category = 'extra_contribution' and direction = 'credit' and receipt_no is not null) = 2, 'two extra payments with receipts');
select public._chk(public.fund_balance_paise(:'fund') = 0, 'balance is exactly zero after paying with the extra money');
select public._chk((select count(*) from public.due_allocations a join public.ledger_entries e on e.id = a.ledger_entry_id where e.category = 'extra_contribution') = 0, 'extra payments never touch the flat''s dues');
select public._chk(public.unit_advance_paise(:'u1', :'fund') = 0, 'and are not counted as advance credit');
select public._chk((select count(distinct user_id) from public.notifications where kind = 'expense_contributions') = (select count(*) from public.memberships where society_id = :'soc' and status = 'active'), 'every member got the contributions notice');
select public._chk((select body from public.notifications where kind = 'expense_contributions' limit 1) like '%P1-GF ₹6,000%' and (select body from public.notifications where kind = 'expense_contributions' limit 1) like '%P2-GF ₹5,000%', 'notice names each flat with its amount');
select public._chk((select title from public.notifications where kind = 'expense_contributions' limit 1) like '%₹11,000 added%', 'notice gives the total');
select public._chk((select count(*) from public.notifications where kind = 'payment_received' and title like '%extra payment%') >= 1, 'the paying flat gets its receipt notice');

\echo '9. Short with no extra payments: go ahead only with a reason, and say so'
select public._clock('2026-12-03');
insert into public.expense_drafts (society_id, template_id, period, amount_paise) values (:'soc', :'t_guard', '2027-01', 1500000);
select id as d_jan from public.expense_drafts where template_id = :'t_guard' and period = '2027-01' \gset
insert into public._gp values ('d_jan', :'d_jan');
select public._clock('2027-01-03');
:as_ad
do $$ begin perform public.pay_fixed_expense(public._gv('d_jan'), 1500000, date '2027-01-03', 'upi', 'UTR4444444444', null, null, 'pay-jan-0001', null, '[]', 'Paid from the committee advance');
  perform public._chk((select note from public.ledger_entries where id = (select ledger_entry_id from public.expense_drafts where id = public._gv('d_jan'))) like '%balance was%short%Paid from the committee advance%', 'reason kept in the note'); end $$;

\echo '10. A different amount still needs a reason'
:as_owner
select public._clock('2027-02-03');
insert into public.expense_drafts (society_id, template_id, period, amount_paise) values (:'soc', :'t_guard', '2027-02', 1500000);
select id as d_feb from public.expense_drafts where template_id = :'t_guard' and period = '2027-02' \gset
insert into public._gp values ('d_feb', :'d_feb');
insert into public.ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, note, created_by)
values (:'soc', :'fund', '2027-02-02', 'credit', 5000000, 'adjustment', 'test credit', :'ad');
:as_ad
do $$ begin begin perform public.pay_fixed_expense(public._gv('d_feb'), 1800000, date '2027-02-03', 'upi', 'UTR5555555555', null, null, 'pay-feb-0001');
  perform public._chk(false, 'changed amount needs a reason'); exception when sqlstate 'P0001' then null; end; end $$;

\echo '11. "Cannot pay yet" notice and the urgent alert'
:as_owner
select public._clock('2027-02-05');
delete from public.notifications;
:as_ad
do $$ begin begin perform public.report_payment_blocked(public._gv('d_feb'), 'Not enough collected'); perform public._chk(false, 'not before the 10th');
  exception when sqlstate 'P0001' then perform public._chk(sqlerrm like '%from the 10th%', 'message: ' || sqlerrm); end; end $$;
:as_owner
select public._clock('2027-02-12');
:as_ad
do $$ begin begin perform public.report_payment_blocked(public._gv('d_feb'), 'abc'); perform public._chk(false, 'needs a real reason');
  exception when sqlstate 'P0001' then null; end;
  perform public.report_payment_blocked(public._gv('d_feb'), 'Collections are short this month');
  begin perform public.report_payment_blocked(public._gv('d_feb'), 'Collections are short this month'); perform public._chk(false, 'only once a day');
  exception when sqlstate 'P0001' then null; end; end $$;
:as_owner
select public._chk((select count(distinct user_id) from public.notifications where kind = 'expense_blocked') = (select count(*) from public.memberships where society_id = :'soc' and status = 'active'), 'everyone told it could not be paid');
select public._chk((select body from public.notifications where kind = 'expense_blocked' limit 1) like '%Collections are short this month%', 'reason is in the notice');
-- urgent alert: refused while the balance covers the payment, sent when short
:as_ad
do $$ begin begin perform public.send_low_balance_alert(public._gv('d_feb')); perform public._chk(false, 'no alert when the balance is enough');
  exception when sqlstate 'P0001' then null; end; end $$;
:as_owner
insert into public.ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, payee, note, created_by)
select :'soc', :'fund', '2027-02-12', 'debit', public.fund_balance_paise(:'fund') - 200000, 'salary', 'Test', 'trim again', :'ad';
delete from public.notifications;
:as_ad
select public.send_low_balance_alert(public._gv('d_feb')) as a \gset
do $$ begin begin perform public.send_low_balance_alert(public._gv('d_feb')); perform public._chk(false, 'alert only once a day');
  exception when sqlstate 'P0001' then null; end; end $$;
:as_owner
select public._chk((select count(distinct user_id) from public.notifications where kind = 'expense_urgent') = (select count(*) from public.memberships where society_id = :'soc' and status = 'active'), 'urgent alert reached everyone');
select public._chk((select title from public.notifications where kind = 'expense_urgent' limit 1) like 'URGENT:%' and (select body from public.notifications where kind = 'expense_urgent' limit 1) like '%lose the security guard%', 'urgent wording');

\echo '12. Residents cannot use any of it'
:as_r1
do $$ begin begin perform public.pay_fixed_expense(public._gv('d_feb'), 1500000, date '2027-02-12', 'cash', null, null, null, 'pay-res-0001'); perform public._chk(false, 'resident pay'); exception when sqlstate '42501' then null; end;
  begin perform public.report_payment_blocked(public._gv('d_feb'), 'Not enough collected'); perform public._chk(false, 'resident report'); exception when sqlstate '42501' then null; end;
  begin perform public.send_low_balance_alert(public._gv('d_feb')); perform public._chk(false, 'resident alert'); exception when sqlstate '42501' then null; end; end $$;

\echo 'ALL guard payment checks passed'
:as_owner
create or replace function public.ist_today() returns date language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
drop function public._clock(date);
drop function public._chk(boolean, text);
drop function public._gv(text);
drop table public._gp;
