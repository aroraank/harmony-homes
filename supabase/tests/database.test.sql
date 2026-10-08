-- Harmony Homes — database test suite (plain SQL assertions).
-- Run on a freshly migrated + seeded database:  ./scripts/test-db.sh
-- Every check raises 'TEST FAIL ...' (SQLSTATE TF001) on failure; the script stops at the first failure.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

-- ===========================================================================
-- Fixtures (as the database owner)
-- ===========================================================================
select id as soc_a from public.societies where slug = 'plot-colony' \gset
select public.general_fund_id(:'soc_a') as gen_a \gset
select id as u_p1gf from public.units where society_id = :'soc_a' and code = 'P1-GF' \gset
select id as u_p2gf from public.units where society_id = :'soc_a' and code = 'P2-GF' \gset
select id as u_p9gf from public.units where society_id = :'soc_a' and code = 'P9-GF' \gset
select id as t_3bhk from public.unit_types where society_id = :'soc_a' and name = '3BHK' \gset

select public.create_society('Other Society', 'other-soc', '2026-01') as soc_b \gset
insert into public.unit_types (society_id, name) values (:'soc_b', 'Shop') returning id as t_b \gset
insert into public.units (society_id, code, display_name, unit_type_id) values (:'soc_b', 'S-1', 'Shop 1', :'t_b') returning id as u_b1 \gset

-- dues start in August so we can test arrears and advances
update public.society_settings set start_month = '2026-08' where society_id = :'soc_a';

-- users
select gen_random_uuid() as sa \gset
select gen_random_uuid() as ad \gset
select gen_random_uuid() as r1 \gset
select gen_random_uuid() as r2 \gset
select gen_random_uuid() as rb \gset
select gen_random_uuid() as newbie \gset
insert into auth.users (id, instance_id, aud, role, email) values
  (:'sa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@plot-colony.local'),
  (:'ad', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rohit@plot-colony.local'),
  (:'r1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p1-gf@plot-colony.local'),
  (:'r2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p2-gf@plot-colony.local'),
  (:'rb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 's-1@other-soc.local'),
  (:'newbie', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p9-gf@plot-colony.local');
select public.bootstrap_super_admin('admin@plot-colony.local', 'plot-colony', 'Ankit Super');
insert into public.profiles (id, full_name, phone) values
  (:'ad', 'Rohit Admin', '9876500001'), (:'r1', 'Resident One', '9876500002'),
  (:'r2', 'Resident Two', '9876500003'), (:'rb', 'Other Resident', '9876500004');
insert into public.profiles (id, full_name, must_change_password) values (:'newbie', 'Plot 9, Ground Floor', true);
insert into public.memberships (user_id, society_id, unit_id, role, status) values
  (:'ad', :'soc_a', null, 'admin', 'active'),
  (:'r1', :'soc_a', :'u_p1gf', 'resident', 'active'),
  (:'r2', :'soc_a', :'u_p2gf', 'resident', 'active'),
  (:'rb', :'soc_b', :'u_b1', 'resident', 'active'),
  (:'newbie', :'soc_a', :'u_p9gf', 'resident', 'active');

-- psql helpers to switch identity
\set as_sa 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''sa'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_ad 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''ad'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r1 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r1'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r2 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r2'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_rb 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''rb'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_new 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''newbie'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_anon 'reset role; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', false); set role anon;'
\set as_owner 'reset role; select set_config(''request.jwt.claims'', '''', false);'

-- store ids for DO blocks
create table public._t (k text primary key, v text);
grant select on public._t to authenticated, anon;
insert into public._t values ('soc_a', :'soc_a'), ('soc_b', :'soc_b'), ('gen_a', :'gen_a'), ('u_p1gf', :'u_p1gf'),
  ('u_p2gf', :'u_p2gf'), ('u_b1', :'u_b1'), ('t_3bhk', :'t_3bhk'), ('r1', :'r1'), ('r2', :'r2'), ('ad', :'ad'), ('sa', :'sa'), ('u_p9gf', :'u_p9gf');
create or replace function public._tv(p text) returns uuid language sql stable as $$ select v::uuid from public._t where k = p $$;
grant execute on function public._tv(text) to authenticated, anon;

\echo '1. Cross-society isolation'
:as_r1
do $$ begin
  if (select count(*) from public.societies) <> 1 then raise exception using errcode = 'TF001', message = 'TEST FAIL: r1 sees other societies'; end if;
  if exists (select 1 from public.units where society_id = public._tv('soc_b')) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r1 sees society B units'; end if;
  if exists (select 1 from public.funds where society_id = public._tv('soc_b')) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r1 sees society B funds'; end if;
  if (select count(*) from public.units) <> 30 then raise exception using errcode = 'TF001', message = 'TEST FAIL: r1 should see 30 units'; end if;
end $$;
:as_rb
do $$ begin
  if exists (select 1 from public.units where society_id = public._tv('soc_a')) then raise exception using errcode = 'TF001', message = 'TEST FAIL: rb sees society A'; end if;
  if exists (select 1 from public.profiles where id = public._tv('r1')) then raise exception using errcode = 'TF001', message = 'TEST FAIL: rb sees r1 profile'; end if;
end $$;

\echo '2. Residents cannot write tables directly'
:as_r1
do $$ begin
  insert into public.ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category)
  values (public._tv('soc_a'), public._tv('gen_a'), current_date, 'credit', 100, 'maintenance');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: resident inserted ledger row';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.units set display_name = 'hacked' where id = public._tv('u_p1gf');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: resident updated unit';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.dues;
  raise exception using errcode = 'TF001', message = 'TEST FAIL: resident deleted dues';
exception when insufficient_privilege then null; end $$;

\echo '3. Residents cannot call admin RPCs'
do $$
declare
  v_calls text[] := array[
    format('select public.generate_monthly_dues(%L, %L)', public._tv('soc_a'), '2026-08'),
    format('select public.record_payment(%L, 80000, current_date, %L, %L, null, null, %L)', public._tv('u_p1gf'), 'cash', null, 'idem-resident-1'),
    format('select public.record_expense(%L, %L, %L, 1000, current_date, %L, null, null, null, %L)', public._tv('gen_a'), 'repair', 'X', 'cash', 'idem-resident-2'),
    format('select public.send_notice(%L, %L, %L, %L, null, %L, null, null, true)', public._tv('soc_a'), 'Hello there', 'Body', 'normal', 'all'),
    format('select public.close_month(%L, %L)', public._tv('soc_a'), '2026-08'),
    format('select public.create_event(%L, %L, null, 100000, %L, %L::uuid[], %L::uuid[], %L::jsonb, current_date + 5)', public._tv('soc_a'), 'Hack event', 'all', '{}', '{}', '[]'),
    format('select public.update_society_settings(%L, %L::jsonb)', public._tv('soc_a'), '{"upi_id":"evil@okaxis"}'),
    format('select public.set_role_permission(%L, %L, %L, true)', public._tv('soc_a'), 'admin', 'manage_users'),
    format('select public.verify_audit_chain(%L)', public._tv('soc_a'))
  ];
  c text;
begin
  foreach c in array v_calls loop
    begin
      execute c;
      raise exception using errcode = 'TF001', message = 'TEST FAIL: resident could run ' || c;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

\echo '4. Must-change-password accounts see nothing'
:as_new
do $$ begin
  if exists (select 1 from public.units) then raise exception using errcode = 'TF001', message = 'TEST FAIL: unchanged-password user sees units'; end if;
  if (public.my_context() -> 'profile' ->> 'must_change_password')::boolean is not true then raise exception using errcode = 'TF001', message = 'TEST FAIL: my_context flag'; end if;
end $$;

\echo '5. Dues generation is idempotent'
:as_ad
do $$ declare v jsonb; begin
  v := public.generate_monthly_dues(public._tv('soc_a'), '2026-08');
  if (v ->> 'created')::int <> 30 then raise exception using errcode = 'TF001', message = 'TEST FAIL: expected 30 dues, got ' || v; end if;
  v := public.generate_monthly_dues(public._tv('soc_a'), '2026-08');
  if (v ->> 'created')::int <> 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: re-run duplicated dues'; end if;
  begin
    perform public.generate_monthly_dues(public._tv('soc_a'), '2099-01');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: future dues allowed';
  exception when raise_exception then null; end;
end $$;

\echo '6. Overpayment becomes advance and auto-settles next month'
do $$ declare v jsonb; s jsonb; begin
  v := public.record_payment(public._tv('u_p2gf'), 100000, current_date, 'upi', 'UTR000000001', 'Aug + extra', null, 'idem-p2-aug');
  if (v ->> 'advance_paise')::bigint <> 20000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: advance should be 20000: ' || v; end if;
  if v ->> 'receipt_no' not like 'HH/2026-27/%' then raise exception using errcode = 'TF001', message = 'TEST FAIL: receipt format ' || v; end if;
  -- idempotent replay returns the same entry
  if (public.record_payment(public._tv('u_p2gf'), 100000, current_date, 'upi', 'UTR000000001', 'Aug + extra', null, 'idem-p2-aug') ->> 'entry_id') <> v ->> 'entry_id' then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: idempotent replay created a new entry';
  end if;
  if (public.month_report(public._tv('soc_a'), '2026-10') -> 'extra_payers' -> 0 ->> 'extra_paise')::bigint <> 20000 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: extra payer not listed';
  end if;
  perform public.generate_monthly_dues(public._tv('soc_a'), '2026-09');
  s := public.unit_period_status(public._tv('u_p2gf'), '2026-09');
  if s ->> 'status' <> 'partial' or (s ->> 'paid_paise')::bigint <> 20000 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: advance did not settle Sep: ' || s;
  end if;
end $$;

\echo '7. Duplicate UTR is blocked unless confirmed'
do $$ begin
  perform public.record_payment(public._tv('u_p1gf'), 80000, current_date, 'upi', 'utr000000001', null, null, 'idem-dup-1');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: duplicate UTR accepted';
exception when raise_exception then
  if sqlerrm not like 'DUPLICATE_REFERENCE%' then raise; end if;
end $$;

\echo '8. Multi-month allocation, preview, and reversal'
do $$ declare p jsonb; v jsonb; r jsonb; s jsonb; begin
  perform public.generate_monthly_dues(public._tv('soc_a'), '2026-10');
  p := public.preview_allocation(public._tv('u_p1gf'), 200000);
  if jsonb_array_length(p -> 'allocations') <> 3 or (p ->> 'advance_paise')::bigint <> 0 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: preview wrong ' || p;
  end if;
  v := public.record_payment(public._tv('u_p1gf'), 200000, current_date, 'cash', null, null, null, 'idem-p1-1');
  s := public.unit_period_status(public._tv('u_p1gf'), '2026-10');
  if s ->> 'status' <> 'partial' or (s ->> 'paid_paise')::bigint <> 40000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: Oct should be partial 400: ' || s; end if;
  -- reason required
  begin
    perform public.reverse_entry((v ->> 'entry_id')::uuid, 'x', 'idem-rev-0');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: reversal without reason';
  exception when raise_exception then null; end;
  r := public.reverse_entry((v ->> 'entry_id')::uuid, 'Typo in amount', 'idem-rev-1');
  if (public.unit_period_status(public._tv('u_p1gf'), '2026-08') ->> 'status') <> 'pending' then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: reversal did not free dues';
  end if;
  begin
    perform public.reverse_entry((v ->> 'entry_id')::uuid, 'Again please', 'idem-rev-2');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: double reversal allowed';
  exception when raise_exception then null; end;
  begin
    perform public.reverse_entry((r -> 'reversal_ids' ->> 0)::uuid, 'Reverse the reversal', 'idem-rev-3');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: reversal of reversal allowed';
  exception when raise_exception then null; end;
  -- correct entry
  perform public.record_payment(public._tv('u_p1gf'), 240000, current_date, 'cash', null, 'Corrected', null, 'idem-p1-2');
  if (public.unit_period_status(public._tv('u_p1gf'), '2026-10') ->> 'status') <> 'paid' then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: corrected payment should pay Oct';
  end if;
end $$;

\echo '9. Ledger is immutable for everyone (including the owner)'
:as_owner
do $$ begin
  update public.ledger_entries set amount_paise = 1;
  raise exception using errcode = 'TF001', message = 'TEST FAIL: owner updated ledger';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.ledger_entries;
  raise exception using errcode = 'TF001', message = 'TEST FAIL: owner deleted ledger';
exception when insufficient_privilege then null; end $$;
do $$ begin
  delete from public.audit_log;
  raise exception using errcode = 'TF001', message = 'TEST FAIL: owner deleted audit';
exception when insufficient_privilege then null; end $$;

\echo '10. Expenses, recurring drafts and balance = funds = credits - debits'
:as_ad
do $$ declare v_draft uuid; v_bal bigint; v_funds bigint; v_hand bigint; begin
  perform public.generate_expense_drafts(public._tv('soc_a'), '2026-10');
  select id into v_draft from public.expense_drafts where status = 'pending' limit 1;
  if v_draft is null then raise exception using errcode = 'TF001', message = 'TEST FAIL: no salary draft'; end if;
  perform public.record_expense(public._tv('gen_a'), 'salary', 'Security guard', 1500000, current_date, 'cash', null, 'Oct salary', null, 'idem-sal-oct', null, v_draft);
  if (select status from public.expense_drafts where id = v_draft) <> 'confirmed' then raise exception using errcode = 'TF001', message = 'TEST FAIL: draft not confirmed'; end if;
  perform public.record_expense(public._tv('gen_a'), 'electricity', 'PSPCL', 230000, current_date, 'upi', 'ELEC12345678', null, null, 'idem-elec-oct');
  v_bal := (public.dashboard(public._tv('soc_a')) ->> 'balance_paise')::bigint;
  select sum((f ->> 'balance_paise')::bigint) into v_funds from jsonb_array_elements(public.dashboard(public._tv('soc_a')) -> 'funds') f;
  -- hand calculation: +100000 +200000 -200000 +240000 -1500000 -230000
  v_hand := 100000 + 200000 - 200000 + 240000 - 1500000 - 230000;
  if v_bal <> v_hand or v_funds <> v_hand then
    raise exception using errcode = 'TF001', message = format('TEST FAIL: balance %s funds %s hand %s', v_bal, v_funds, v_hand);
  end if;
end $$;

\echo '11. Month view shows shortfall covered from previous balance'
do $$ declare m jsonb; begin
  m := public.month_report(public._tv('soc_a'), '2026-10');
  if (m ->> 'shortfall_paise')::bigint <> 1390000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: shortfall ' || (m ->> 'shortfall_paise'); end if;
  if (m ->> 'closing_paise')::bigint <> (m ->> 'opening_paise')::bigint + (m ->> 'net_paise')::bigint then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: opening + net <> closing';
  end if;
  if (m ->> 'expected_paise')::bigint <> 30 * 80000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: expected collection'; end if;
end $$;

\echo '12. Event: 18 in scope, 3 excluded -> 15 x ₹16,000; close moves surplus to General'
do $$ declare v_event uuid; r jsonb; v_excl jsonb; v_before bigint; v_after bigint; v_unit uuid; begin
  select jsonb_agg(jsonb_build_object('unit_id', id, 'reason', 'Owner abroad')) into v_excl
    from (select id from public.units where society_id = public._tv('soc_a') and unit_type_id = public._tv('t_3bhk') order by sort_order desc limit 3) t;
  v_event := public.create_event(public._tv('soc_a'), 'Motor repair test', 'Test', 24000000, 'unit_types',
                                 array[public._tv('t_3bhk')], '{}', v_excl, current_date + 10, 1000, true);
  r := public.event_report(v_event);
  if (r -> 'event' ->> 'in_scope_count')::int <> 18 or (r -> 'event' ->> 'expected_count')::int <> 15
     or (r -> 'event' ->> 'per_unit_share_paise')::bigint <> 1600000 or (r ->> 'rounding_buffer_paise')::bigint <> 0 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: event split ' || (r -> 'event');
  end if;
  if (select count(*) from public.dues where event_id = v_event) <> 15 then raise exception using errcode = 'TF001', message = 'TEST FAIL: event dues count'; end if;
  -- rounding: 2,40,000 / 18 = 13,333.33 -> ₹13,340 with ₹10 rounding
  if public.event_share_paise(24000000, 18, 1000) <> 1334000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: rounding'; end if;
  select unit_id into v_unit from public.event_units where event_id = v_event and expected limit 1;
  perform public.record_payment(v_unit, 1600000, current_date, 'bank', 'NEFT00000001', null, null, 'idem-ev-pay',
                                (select fund_id from public.events where id = v_event));
  r := public.event_report(v_event);
  if (r ->> 'remaining_to_collect_paise')::bigint <> 14 * 1600000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: remaining ' || (r ->> 'remaining_to_collect_paise'); end if;
  v_before := public.society_balance_paise(public._tv('soc_a'));
  r := public.close_event(v_event, true, null);
  v_after := public.society_balance_paise(public._tv('soc_a'));
  if (r ->> 'moved_paise')::bigint <> 1600000 or v_before <> v_after then raise exception using errcode = 'TF001', message = 'TEST FAIL: close transfer ' || r; end if;
  if public.fund_balance_paise((select fund_id from public.events where id = v_event)) <> 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: event fund not zero'; end if;
end $$;

\echo '13. Payment claims: submit, isolation, approve -> receipt, reject'
:as_r1
select public.submit_payment_claim(:'soc_a', 80000, current_date, 'gpay', 'GPAY12345678', null, 'Nov advance') as claim1 \gset
do $$ begin
  perform public.submit_payment_claim(public._tv('soc_a'), 80000, current_date, 'gpay', 'GPAY12345678', null, null);
  raise exception using errcode = 'TF001', message = 'TEST FAIL: duplicate claim UTR accepted';
exception when raise_exception then null; end $$;
:as_r2
do $$ begin
  if exists (select 1 from public.payment_claims) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 sees r1 claim'; end if;
  begin
    perform public.approve_claim((select v::uuid from public._t where k = 'none'));
  exception when raise_exception then null; end;
end $$;
:as_ad
do $$ declare v jsonb; c uuid; begin
  select id into c from public.payment_claims where status = 'pending' limit 1;
  v := public.approve_claim(c);
  if v ->> 'receipt_no' is null then raise exception using errcode = 'TF001', message = 'TEST FAIL: no receipt on approval'; end if;
  begin
    perform public.approve_claim(c);
    raise exception using errcode = 'TF001', message = 'TEST FAIL: double approval';
  exception when raise_exception then null; end;
  -- receipts are sequential and gap free
  if (select count(distinct receipt_no) from public.ledger_entries where receipt_no is not null)
     <> (select max(split_part(receipt_no, '/', 3)::int) from public.ledger_entries where receipt_no is not null) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: receipt numbers have gaps';
  end if;
end $$;
:as_r1
do $$ begin
  if (select status from public.payment_claims limit 1) <> 'approved' then raise exception using errcode = 'TF001', message = 'TEST FAIL: r1 cannot see approved claim'; end if;
  if not exists (select 1 from public.notifications where kind = 'payment_received') then raise exception using errcode = 'TF001', message = 'TEST FAIL: no receipt notification'; end if;
end $$;

\echo '14. Concerns are private to the raiser and admins'
:as_r1
select public.raise_concern(:'soc_a', 'Water leakage', 'water', 'Leak near the tank', 'urgent', null, true) as concern1 \gset
:as_r2
do $$ begin
  if exists (select 1 from public.v_concerns) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 sees r1 concern'; end if;
  if exists (select 1 from public.v_concern_messages) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 sees r1 messages'; end if;
  begin
    perform 1 from public.concerns;
    raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 can read concerns table';
  exception when insufficient_privilege then null; end;
  begin
    perform public.reply_concern((select id from public.v_concerns limit 1), 'hi', null);
  exception when raise_exception or null_value_not_allowed then null; end;
end $$;
do $$ begin
  perform public.reply_concern(public._tv('none'), 'sneaky', null);
  raise exception using errcode = 'TF001', message = 'TEST FAIL: reply to unknown concern';
exception when raise_exception then null; end $$;
:as_rb
do $$ begin
  if exists (select 1 from public.v_concerns) then raise exception using errcode = 'TF001', message = 'TEST FAIL: other society sees concern'; end if;
end $$;
:as_ad
do $$ declare c record; begin
  select * into c from public.v_concerns limit 1;
  if c.id is null then raise exception using errcode = 'TF001', message = 'TEST FAIL: admin cannot see concern'; end if;
  if c.raised_by is not null or c.raiser_name is not null then raise exception using errcode = 'TF001', message = 'TEST FAIL: hidden name visible to admin'; end if;
  perform public.reply_concern(c.id, 'Plumber is coming at 5 pm', null);
  if (select status from public.v_concerns where id = c.id) <> 'in_progress' then raise exception using errcode = 'TF001', message = 'TEST FAIL: status not in_progress'; end if;
end $$;
:as_sa
do $$ begin
  if (select raiser_name from public.v_concerns limit 1) is null then raise exception using errcode = 'TF001', message = 'TEST FAIL: super admin cannot see author'; end if;
end $$;
:as_r1
do $$ begin
  if (select count(*) from public.v_concern_messages) <> 2 then raise exception using errcode = 'TF001', message = 'TEST FAIL: raiser should see 2 messages'; end if;
  if not exists (select 1 from public.notifications where kind = 'concern_reply') then raise exception using errcode = 'TF001', message = 'TEST FAIL: raiser not notified'; end if;
end $$;

\echo '15. Notices: receipts, acknowledgement with location, location never in audit'
:as_ad
select public.send_notice(:'soc_a', 'Water off Sunday', 'Water supply will be off from **10 am to 2 pm**.<script>x</script>', 'important', null, 'all', null, null, true) as notice1 \gset
:as_r1
do $$ declare n record; begin
  select * into n from public.notices limit 1;
  if n.body like '%<script>%' then raise exception using errcode = 'TF001', message = 'TEST FAIL: HTML not stripped'; end if;
  perform public.acknowledge_notice(n.id, 30.9, 75.85, 20);
  if (select acknowledged_at from public.notice_receipts where notice_id = n.id and user_id = auth.uid()) is null then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: ack not recorded';
  end if;
end $$;
:as_r2
do $$ begin
  if exists (select 1 from public.notice_receipts where user_id <> auth.uid()) then raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 sees others receipts'; end if;
end $$;
:as_ad
do $$ declare v int; begin
  if (select count(*) from public.notice_receipts where acknowledged_at is not null) <> 1 then raise exception using errcode = 'TF001', message = 'TEST FAIL: admin ack count'; end if;
  v := public.remind_notice_pending((select id from public.notices limit 1));
  if v < 1 then raise exception using errcode = 'TF001', message = 'TEST FAIL: remind pending'; end if;
end $$;
:as_owner
do $$ begin
  if exists (select 1 from public.audit_log where table_name = 'notice_receipts' and (after ? 'ack_lat' or before ? 'ack_lat')) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: location copied into audit log';
  end if;
end $$;

\echo '16. Closed months are locked; only super admin reopens'
:as_ad
do $$ begin
  perform public.close_month(public._tv('soc_a'), '2026-08');
  begin
    perform public.record_payment(public._tv('u_p1gf'), 1000, date '2026-08-20', 'cash', null, null, null, 'idem-closed-1', null, 'late entry for august');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: entry in closed month';
  exception when raise_exception then null; end;
  begin
    perform public.reopen_month(public._tv('soc_a'), '2026-08', 'Need a correction');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: admin reopened month';
  exception when insufficient_privilege then null; end;
end $$;
:as_sa
do $$ begin
  perform public.reopen_month(public._tv('soc_a'), '2026-08', 'Need a correction');
  perform public.record_payment(public._tv('u_p1gf'), 1000, date '2026-08-20', 'cash', null, null, null, 'idem-closed-2', null, 'late entry for august');
end $$;

\echo '17. Audit log: residents see nothing, admin sees own, chain verifies'
:as_r1
do $$ begin
  if exists (select 1 from public.audit_log) then raise exception using errcode = 'TF001', message = 'TEST FAIL: resident sees audit log'; end if;
end $$;
:as_ad
do $$ begin
  if exists (select 1 from public.audit_log where actor_id is distinct from auth.uid()) then raise exception using errcode = 'TF001', message = 'TEST FAIL: admin sees others audit'; end if;
  if not exists (select 1 from public.audit_log where table_name = 'ledger_entries') then raise exception using errcode = 'TF001', message = 'TEST FAIL: ledger not audited'; end if;
end $$;
:as_sa
do $$ declare v jsonb; begin
  v := public.verify_audit_chain(public._tv('soc_a'));
  if not (v ->> 'ok')::boolean then raise exception using errcode = 'TF001', message = 'TEST FAIL: chain broken ' || v; end if;
end $$;

\echo '18. Roles: at least one super admin; admins cannot grant super admin'
:as_sa
do $$ begin
  perform public.set_member_role((select id from public.memberships where user_id = auth.uid()), 'admin');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: last super admin demoted';
exception when raise_exception then null; end $$;
:as_ad
do $$ begin
  perform public.set_member_role((select id from public.memberships where user_id = public._tv('r1')), 'super_admin');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: admin granted super admin';
exception when insufficient_privilege then null; end $$;

\echo '18b. Settings: valid UPI saved and alerts the super admin; bad UPI rejected; locale'
:as_sa
do $$ begin
  perform public.update_society_settings(public._tv('soc_a'), '{"upi_id":"plotcolony@okhdfcbank","upi_payee_name":"Plot Colony"}');
  if (select upi_id from public.society_settings where society_id = public._tv('soc_a')) <> 'plotcolony@okhdfcbank' then raise exception using errcode = 'TF001', message = 'TEST FAIL: upi not saved'; end if;
  if not exists (select 1 from public.alerts where kind = 'payment_details_changed') then raise exception using errcode = 'TF001', message = 'TEST FAIL: no upi alert'; end if;
  begin
    perform public.update_society_settings(public._tv('soc_a'), '{"upi_id":"not-a-upi"}');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: bad upi accepted';
  exception when raise_exception then null; end;
  perform public.set_my_locale('hi');
end $$;

\echo '19. Admin of society A cannot act on society B'
:as_ad
do $$ begin
  perform public.record_payment(public._tv('u_b1'), 1000, current_date, 'cash', null, null, null, 'idem-cross-1');
  raise exception using errcode = 'TF001', message = 'TEST FAIL: cross-society payment';
exception when insufficient_privilege then null; end $$;

\echo '20. Storage policies'
:as_r1
do $$ begin
  insert into storage.objects (bucket_id, name) values ('attachments', public._tv('soc_a') || '/claims/' || auth.uid() || '/shot.png');
  begin
    insert into storage.objects (bucket_id, name) values ('attachments', public._tv('soc_a') || '/claims/' || public._tv('r2') || '/x.png');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: wrote into another user claims folder';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('attachments', public._tv('soc_b') || '/claims/' || auth.uid() || '/x.png');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: wrote into another society';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('attachments', public._tv('soc_a') || '/settings/qr.png');
    raise exception using errcode = 'TF001', message = 'TEST FAIL: resident wrote settings';
  exception when insufficient_privilege then null; end;
end $$;
:as_r2
do $$ begin
  if exists (select 1 from storage.objects where name like '%/claims/%') then raise exception using errcode = 'TF001', message = 'TEST FAIL: r2 reads r1 claim screenshot'; end if;
end $$;

\echo '21. Anonymous access is limited to public endpoints'
:as_anon
do $$ begin
  begin
    perform 1 from public.units;
    raise exception using errcode = 'TF001', message = 'TEST FAIL: anon reads units';
  exception when insufficient_privilege then null; end;
  begin
    perform public.dashboard(public._tv('soc_a'));
    raise exception using errcode = 'TF001', message = 'TEST FAIL: anon calls dashboard';
  exception when insufficient_privilege then null; end;
  if public.society_public('plot-colony') is null then raise exception using errcode = 'TF001', message = 'TEST FAIL: society_public'; end if;
  if jsonb_array_length(public.registration_options('plot-colony') -> 'units') <> 30 then raise exception using errcode = 'TF001', message = 'TEST FAIL: registration options'; end if;
end $$;

\echo '22. Reports run for every role'
:as_r2
do $$ begin
  perform public.dashboard(public._tv('soc_a'));
  perform public.month_report(public._tv('soc_a'), '2026-10');
  perform public.unit_statement(public._tv('u_p2gf'));
  perform public.defaulters(public._tv('soc_a'));
  perform public.trend_months(public._tv('soc_a'), 12);
  perform public.my_pay_info(public._tv('soc_a'));
  perform public.my_reminder_cards(public._tv('soc_a'));
  if (select count(*) from public.v_ledger) = 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: v_ledger empty'; end if;
  if (select count(*) from public.v_dues) = 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: v_dues empty'; end if;
end $$;
\echo '23. Pay for chosen months, surplus alerts, privacy, statements'
:as_ad
do $$
declare
  p jsonb; v jsonb; d1 uuid; d2 uuid; n int; tot bigint; adv bigint; st jsonb; ls jsonb;
begin
  p := public.preview_allocation(public._tv('u_p9gf'), 0);
  n := jsonb_array_length(p -> 'pending');
  if n < 2 then raise exception using errcode = 'TF001', message = 'TEST FAIL: expected 2+ open months for P9-GF, got ' || n; end if;
  d1 := (p -> 'pending' -> 0 ->> 'due_id')::uuid;           -- oldest
  d2 := (p -> 'pending' -> (n - 1) ->> 'due_id')::uuid;     -- newest
  -- pay only the newest month exactly
  v := public.record_payment(public._tv('u_p9gf'), (p -> 'pending' -> (n - 1) ->> 'remaining_paise')::bigint, current_date, 'cash',
         null, null, null, 'idem-m-1', null, null, false, array[d2]);
  if public.due_remaining_paise(d2) <> 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: chosen month not paid'; end if;
  if public.due_remaining_paise(d1) <= 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: older month must stay open'; end if;
  if exists (select 1 from jsonb_array_elements(public.preview_allocation(public._tv('u_p9gf'), 0) -> 'pending') x where (x ->> 'due_id')::uuid = d2) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: paid month still offered';
  end if;
  begin
    perform public.record_payment(public._tv('u_p9gf'), 1000, current_date, 'cash', null, null, null, 'idem-m-2', null, null, false, array[d2]);
    raise exception using errcode = 'TF001', message = 'TEST FAIL: paid month accepted again';
  exception when sqlstate 'P0001' then null; end;
  -- pay a chosen month with extra: the extra settles older pending, no advance yet
  p := public.preview_allocation(public._tv('u_p9gf'), 0);
  tot := (p ->> 'pending_total_paise')::bigint;
  -- a big overpayment => surplus
  v := public.record_payment(public._tv('u_p9gf'), tot + 25000, current_date, 'cash', null, null, null, 'idem-m-3');
  adv := public.unit_advance_paise(public._tv('u_p9gf'), public._tv('gen_a'));
  if adv <> 25000 then raise exception using errcode = 'TF001', message = 'TEST FAIL: advance should be 25000, got ' || adv; end if;
  -- statement maths: owed - advance = closing balance
  st := public.unit_statement(public._tv('u_p9gf'));
  ls := public.unit_ledger_statement(public._tv('u_p9gf'), null, null);
  if (ls ->> 'opening_paise')::bigint + (select coalesce(sum((x ->> 'debit_paise')::bigint - (x ->> 'credit_paise')::bigint), 0) from jsonb_array_elements(ls -> 'rows') x)
       <> (st -> 'totals' ->> 'pending_paise')::bigint - (st -> 'totals' ->> 'advance_paise')::bigint then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: flat statement does not balance';
  end if;
  ls := public.ledger_statement(public._tv('soc_a'), null, null, null);
  if (ls ->> 'opening_paise')::bigint + (select coalesce(sum(case when x ->> 'direction' = 'credit' then (x ->> 'amount_paise')::bigint else -(x ->> 'amount_paise')::bigint end), 0) from jsonb_array_elements(ls -> 'rows') x)
       <> public.society_balance_paise(public._tv('soc_a')) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: society statement does not balance';
  end if;
  perform public.log_statement_export(public._tv('soc_a'), 'ledger', null, current_date - 30, current_date);
end $$;

-- admin and super admin were both told about the surplus
:as_owner
do $$ begin
  if (select count(distinct user_id) from public.notifications where kind = 'surplus_payment'
        and user_id in (public._tv('sa'), public._tv('ad'))) <> 2 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: admin + super admin must be told about surplus';
  end if;
end $$;

-- a resident sees who paid extra, but not other flats' dues
:as_r2
do $$
declare mine int; others int; r jsonb;
begin
  if not exists (select 1 from jsonb_array_elements(public.surplus_board(public._tv('soc_a'))) x where x ->> 'unit_code' = 'P9-GF' and (x ->> 'advance_paise')::bigint = 25000) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: surplus board must list the advance payer';
  end if;
  select count(*) into others from public.dues where unit_id = public._tv('u_p1gf');
  if others <> 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: resident can read another flat''s dues'; end if;
  select count(*) into mine from public.dues where unit_id = public._tv('u_p2gf');
  if mine = 0 then raise exception using errcode = 'TF001', message = 'TEST FAIL: resident cannot read own dues'; end if;
  begin
    perform public.unit_statement(public._tv('u_p1gf'));
    raise exception using errcode = 'TF001', message = 'TEST FAIL: other flat statement readable';
  exception when insufficient_privilege then null; end;
  begin
    perform public.unit_ledger_statement(public._tv('u_p1gf'), null, null);
    raise exception using errcode = 'TF001', message = 'TEST FAIL: other flat ledger statement readable';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from jsonb_array_elements(public.defaulters(public._tv('soc_a'))) x where x ->> 'unit_code' <> 'P2-GF') then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: defaulters leaks other flats';
  end if;
  r := public.month_report(public._tv('soc_a'), '2026-10');
  if exists (select 1 from jsonb_array_elements(r -> 'units') x where x ->> 'status' in ('pending', 'partial') and x ->> 'unit_code' <> 'P2-GF') then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: month report leaks other flats'' pending';
  end if;
  perform public.ledger_statement(public._tv('soc_a'), current_date - 60, current_date, null);
  perform public.unit_ledger_statement(public._tv('u_p2gf'), current_date - 60, current_date);
end $$;

\echo '24. Forgot-PIN requests and society position'
:as_anon
do $$ begin
  perform public.request_pin_reset('plot-colony', 'P1-GF');
  perform public.request_pin_reset('plot-colony', 'P1-GF');   -- second one inside an hour is ignored
  perform public.request_pin_reset('plot-colony', 'NOPE-99');  -- unknown flat: same silent answer
  perform public.request_pin_reset('no-such-society', 'P1-GF');
end $$;
:as_owner
do $$ declare n int; begin
  select count(*) into n from public.pin_reset_requests;
  if n <> 1 then raise exception using errcode = 'TF001', message = 'TEST FAIL: expected exactly 1 pin request, got ' || n; end if;
  if (select count(distinct user_id) from public.notifications where kind = 'pin_reset_request'
        and user_id in (public._tv('sa'), public._tv('ad'))) <> 2 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: admin + super admin must be told about the PIN request';
  end if;
  perform public._after_password_reset(public._tv('sa'), public._tv('r1'));
  if exists (select 1 from public.pin_reset_requests where resolved_at is null) then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: reset must close the request';
  end if;
end $$;
:as_r2
do $$ declare p jsonb; begin
  if (select count(*) from public.pin_reset_requests) <> 0 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: resident can read PIN requests';
  end if;
  p := public.society_position(public._tv('soc_a'));
  if jsonb_array_length(p -> 'funds') < 1 or (p -> 'totals' ->> 'advance_paise')::bigint < 25000 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: society position missing figures';
  end if;
end $$;
:as_ad
do $$ begin
  if (select count(*) from public.pin_reset_requests) <> 1 then
    raise exception using errcode = 'TF001', message = 'TEST FAIL: admin cannot read PIN requests';
  end if;
end $$;

:as_owner
do $$ declare v jsonb; begin
  v := public.run_daily_jobs();
  if v::text like '%error%' then raise exception using errcode = 'TF001', message = 'TEST FAIL: daily jobs ' || v; end if;
end $$;

:as_owner
drop function public._tv(text);
drop table public._t;
\echo 'ALL DATABASE TESTS PASSED'
