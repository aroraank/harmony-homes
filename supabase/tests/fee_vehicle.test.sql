-- Harmony Homes — tests for the ₹800 → ₹1,000 guard change, fee acknowledgement and the vehicle rules.
-- Run on a database that has ALL migrations applied and the seed loaded (it is independent of database.test.sql):
--   psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/fee_vehicle.test.sql
-- It creates its own users, makes a guard series like the live one (₹24,000, due the NEXT month, Oct + Nov published),
-- and then re-applies the new migration (idempotent) so the one-time change runs against that series.
-- Every check raises 'TEST FAIL ...' on failure. Run it on a scratch/local database, never on production.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

select id as soc from public.societies where slug = 'plot-colony' \gset
select id as u1 from public.units where society_id = :'soc' and code = 'P1-GF' \gset
select id as u2 from public.units where society_id = :'soc' and code = 'P2-GF' \gset
select id as u3 from public.units where society_id = :'soc' and code = 'P3-FF' \gset
select gen_random_uuid() as sa \gset
select gen_random_uuid() as ad \gset
select gen_random_uuid() as r1 \gset
select gen_random_uuid() as r2 \gset
select gen_random_uuid() as r3 \gset
insert into auth.users (id, instance_id, aud, role, email) values
 (:'sa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fv-sa@plot-colony.local'),
 (:'ad','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fv-ad@plot-colony.local'),
 (:'r1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fv-p1@plot-colony.local'),
 (:'r2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fv-p2@plot-colony.local'),
 (:'r3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fv-p3@plot-colony.local');
insert into public.profiles (id, full_name, phone) values
 (:'sa','FV Super','9876501000'), (:'ad','FV Admin','9876501001'), (:'r1','FV One','9876501002'),
 (:'r2','FV Two','9876501003'), (:'r3','FV Three','9876501004');
insert into public.memberships (user_id, society_id, unit_id, role, status) values
 (:'sa', :'soc', null, 'super_admin', 'active'), (:'ad', :'soc', null, 'admin', 'active'),
 (:'r1', :'soc', :'u1', 'resident', 'active'), (:'r2', :'soc', :'u2', 'resident', 'active'),
 (:'r3', :'soc', :'u3', 'resident', 'active');

\set as_sa 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''sa'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_ad 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''ad'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r1 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r1'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r2 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r2'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_r3 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''r3'', ''role'', ''authenticated'')::text, false); set role authenticated;'
\set as_owner 'reset role; select set_config(''request.jwt.claims'', '''', false);'

create table public._fv (k text primary key, v text);
grant select on public._fv to authenticated;
insert into public._fv values ('soc', :'soc'), ('u1', :'u1'), ('u2', :'u2'), ('u3', :'u3'), ('sa', :'sa'), ('ad', :'ad'), ('r1', :'r1'), ('r2', :'r2'), ('r3', :'r3');
create or replace function public._fvv(p text) returns uuid language sql stable as $$ select v::uuid from public._fv where k = p $$;
grant execute on function public._fvv(text) to authenticated;
create or replace function public._chk(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception using errcode = 'TF001', message = 'TEST FAIL: ' || p_msg; end if; end $$;
grant execute on function public._chk(boolean, text) to authenticated;

-- the guard series as it is live: ₹24,000 / 30 flats = ₹800, due the 7th of the NEXT month; Oct and Nov already generated
:as_sa
select public.create_event_series(:'soc', 'Security guard salary', null, 2400000, 'all', '{}', 7, false, 1) as ser \gset
:as_owner
select public._publish_series_month(:'ser', '2026-10') \gset
select public._publish_series_month(:'ser', '2026-11') \gset
insert into public._fv values ('ser', :'ser');
delete from public.notifications;

\echo '1. One-time ₹800 → ₹1,000 change (applied by re-running the migration)'
\ir ../migrations/20261118000001_fee_increase_vehicle_rules.sql
select public._chk((select count(*) from public.fee_changes where series_id = public._fvv('ser')) = 1, 'one fee change recorded');
select public._chk((select pending_total_paise from public.event_series where id = public._fvv('ser')) = 3000000, 'pending total is ₹30,000');
select public._chk((select pending_from_period from public.event_series where id = public._fvv('ser')) = '2026-12', 'starts with the December 2026 event');
select public._chk((select total_cost_paise from public.event_series where id = public._fvv('ser')) = 2400000, 'current total untouched');
select public._chk((select bool_and(per_unit_share_paise = 80000 and total_cost_paise = 2400000) from public.events where series_id = public._fvv('ser') and series_period in ('2026-10', '2026-11')), 'Oct and Nov events still ₹800 per flat');
select public._chk((select old_share_paise = 80000 and new_share_paise = 100000 from public.fee_changes where series_id = public._fvv('ser')), 'notice says ₹800 → ₹1,000');
select public._chk((select count(*) from public.notifications where kind = 'fee_change') = 5, 'all 5 members incl. admins notified');
select public._chk((select count(*) from public.notifications where kind = 'fee_change' and user_id in (public._fvv('sa'), public._fvv('ad'))) = 2, 'admin and super admin notified');
-- running the migration again changes nothing and notifies nobody twice
\ir ../migrations/20261118000001_fee_increase_vehicle_rules.sql
select public._chk((select count(*) from public.fee_changes where series_id = public._fvv('ser')) = 1, 're-run does not duplicate the notice');
select public._chk((select count(*) from public.notifications where kind = 'fee_change') = 5, 're-run does not notify twice');
-- December onward is generated at ₹1,000; November stays ₹800
select public._chk(public._series_total_for(public._fvv('ser'), '2026-11') = 2400000, 'Nov total still ₹24,000');
select public._chk(public._series_total_for(public._fvv('ser'), '2026-12') = 3000000, 'Dec total ₹30,000');
select public._publish_series_month(public._fvv('ser'), '2026-12') as dec_ev \gset
select public._chk((select per_unit_share_paise from public.events where id = :'dec_ev') = 100000, 'December event is ₹1,000 per flat');
select public._chk((select per_unit_share_paise from public.events where series_id = public._fvv('ser') and series_period = '2026-11') = 80000, 'November event still ₹800 after December is generated');
delete from public.events where id = :'dec_ev';

\echo '2. Fee notice popup + acknowledgement'
:as_r1
do $$ declare v jsonb; begin
  v := public.my_fee_change_prompt(public._fvv('soc'));
  perform public._chk((v->>'show')::boolean and v->>'mode' = 'resident', 'resident sees the notice');
  perform public._chk((v->'change'->>'increase_paise')::bigint = 20000, 'increase is ₹200');
end $$;
:as_ad
do $$ declare v jsonb; begin
  v := public.my_fee_change_prompt(public._fvv('soc'));
  perform public._chk((v->>'show')::boolean and v->>'mode' = 'admin', 'admin sees the admin version');
  begin perform public.acknowledge_fee_change((v->'change'->>'id')::uuid); perform public._chk(false, 'admin must not acknowledge');
  exception when sqlstate '42501' then null; end;
end $$;
:as_r1
select (public.my_fee_change_prompt(public._fvv('soc'))->'change'->>'id')::uuid as fc \gset
select public.acknowledge_fee_change(:'fc');
select public.acknowledge_fee_change(:'fc');
do $$ begin
  perform public._chk(not (public.my_fee_change_prompt(public._fvv('soc'))->>'show')::boolean, 'popup gone after acknowledging');
  begin perform public.fee_change_overview(public._fvv('soc')); perform public._chk(false, 'resident must not see overview');
  exception when sqlstate '42501' then null; end;
end $$;
:as_r2
do $$ begin perform public._chk((public.my_fee_change_prompt(public._fvv('soc'))->>'show')::boolean, 'another flat still sees it'); end $$;
:as_owner
select public._chk((select count(*) from public.notifications where kind = 'fee_change_ack') = 2, 'admin + super admin notified once (second tap ignored)');
select public._chk((select count(*) from public.audit_log where action = 'fee_change_acknowledged') = 1, 'acknowledgement is in the audit log');
:as_sa
do $$ declare o jsonb; begin
  o := public.fee_change_overview(public._fvv('soc'));
  perform public._chk(jsonb_array_length(o->0->'flats') = 30, 'overview lists all 30 flats');
  perform public._chk((select count(*) from jsonb_array_elements(o->0->'flats') f where f->>'status' = 'acknowledged') = 1, 'exactly one acknowledged');
  perform public._chk((select f->>'status' from jsonb_array_elements(o->0->'flats') f where f->>'code' = 'P1-GF') = 'acknowledged', 'P1-GF shown as acknowledged');
  perform public._chk((select f->>'status' from jsonb_array_elements(o->0->'flats') f where f->>'code' = 'P2-GF') = 'pending', 'P2-GF still pending');
  perform public.mark_fee_change_seen_by_admin((o->0->>'id')::uuid);
  perform public._chk(not (public.my_fee_change_prompt(public._fvv('soc'))->>'show')::boolean, 'super admin can close it');
end $$;

\echo '3. Vehicles: 3 skips, then forced'
:as_ad
do $$ begin perform public._chk(not (public.my_vehicle_gate(public._fvv('soc'))->>'applies')::boolean, 'admins are exempt'); end $$;
:as_r1
do $$ declare v jsonb; begin
  v := public.my_vehicle_gate(public._fvv('soc'));
  perform public._chk(v->>'state' = 'ask' and (v->>'skips_left')::int = 3, 'starts with 3 skips');
  perform public._chk((public.skip_vehicle_prompt(public._fvv('soc'))->>'skips_left')::int = 2, 'skip 1 -> 2 left');
  perform public._chk((public.skip_vehicle_prompt(public._fvv('soc'))->>'skips_left')::int = 1, 'skip 2 -> 1 left');
  perform public._chk(public.my_vehicle_gate(public._fvv('soc'))->>'state' = 'ask', 'still optional after 2 skips');
  perform public._chk((public.skip_vehicle_prompt(public._fvv('soc'))->>'skips_left')::int = 0, 'skip 3 -> 0 left');
  v := public.my_vehicle_gate(public._fvv('soc'));
  perform public._chk(v->>'state' = 'force', 'forced after 3 skips');
  begin perform public.skip_vehicle_prompt(public._fvv('soc')); perform public._chk(false, 'a 4th skip must fail');
  exception when sqlstate 'P0001' then null; end;
end $$;
:as_r2
do $$ begin perform public._chk((public.my_vehicle_gate(public._fvv('soc'))->>'skips_left')::int = 3, 'skips are per flat: P2-GF unaffected'); end $$;

\echo '4. Owner / tenant tag'
:as_r1
do $$ begin
  begin perform public.add_vehicle(public._fvv('soc'), public._fvv('u1'), 'CH01AB1234', 'car', null, null, null);
        perform public._chk(false, 'holder is required');
  exception when sqlstate 'P0001' then null; end;
  begin perform public.add_vehicle(public._fvv('soc'), public._fvv('u1'), 'CH01AB1234', 'car', null, null, 'guest');
        perform public._chk(false, 'bad holder rejected');
  exception when sqlstate 'P0001' then null; end;
  perform public.add_vehicle(public._fvv('soc'), public._fvv('u1'), 'CH01AB1234', 'car', 'Verna', 'White', 'owner');
  perform public.add_vehicle(public._fvv('soc'), public._fvv('u1'), 'PB65CD5678', 'bike', null, null, 'tenant');
  perform public.add_vehicle(public._fvv('soc'), public._fvv('u1'), 'PB65CD9999', 'scooter', null, null, 'tenant');
  perform public._chk(public.my_vehicle_gate(public._fvv('soc'))->>'state' = 'done', 'adding a vehicle completes the requirement');
  perform public._chk((select count(*) from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'holder' = 'tenant') = 2, 'directory shows the tenant tag');
  perform public.update_vehicle((select (d->>'id')::uuid from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'plate' = 'PB65CD9999'), 'PB65CD9999', 'scooter', null, null, 'owner');
  perform public._chk((select d->>'holder' from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'plate' = 'PB65CD9999') = 'owner', 'tag can be changed');
  perform public.update_vehicle((select (d->>'id')::uuid from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'plate' = 'PB65CD9999'), 'PB65CD9999', 'scooter', null, null, 'tenant');
end $$;

\echo '5. "I do not have a vehicle" is recorded and notified'
:as_r1
do $$ begin begin perform public.declare_no_vehicle(public._fvv('soc')); perform public._chk(false, 'cannot declare none while vehicles exist');
  exception when sqlstate 'P0001' then null; end; end $$;
:as_r2
select public.declare_no_vehicle(public._fvv('soc'));
do $$ declare v jsonb; begin v := public.my_vehicle_gate(public._fvv('soc'));
  perform public._chk(v->>'state' = 'done' and (v->>'no_vehicle')::boolean, 'no-vehicle satisfies the rule');
  perform public._chk(not (v->>'review_due')::boolean, 'no review due right after declaring');
end $$;
:as_owner
select public._chk((select count(*) from public.notifications where kind = 'no_vehicle_declared' and user_id in (public._fvv('sa'), public._fvv('ad'))) = 2, 'admin and super admin notified');
select public._chk((select count(*) from public.audit_log where action = 'no_vehicle_declared') = 1, 'recorded as an event in the audit log');
:as_sa
do $$ declare c jsonb; begin c := public.vehicle_compliance(public._fvv('soc'));
  perform public._chk(jsonb_array_length(c->'flats') = 30, 'compliance lists all flats');
  perform public._chk((select f->>'status' from jsonb_array_elements(c->'flats') f where f->>'code' = 'P1-GF') = 'has_vehicles', 'P1-GF has vehicles');
  perform public._chk((select f->>'status' from jsonb_array_elements(c->'flats') f where f->>'code' = 'P2-GF') = 'no_vehicle', 'P2-GF has none');
  perform public._chk((select f->>'status' from jsonb_array_elements(c->'flats') f where f->>'code' = 'P3-FF') = 'pending', 'P3-FF not answered');
end $$;
:as_r3
do $$ begin begin perform public.vehicle_compliance(public._fvv('soc')); perform public._chk(false, 'resident must not see compliance');
  exception when sqlstate '42501' then null; end; end $$;
:as_r2
select public.add_vehicle(public._fvv('soc'), public._fvv('u2'), 'HR26EF1111', 'car', null, null, 'owner');
do $$ begin perform public._chk(not (public.my_vehicle_gate(public._fvv('soc'))->>'no_vehicle')::boolean, 'adding a vehicle clears the "none" flag'); end $$;

\echo '6. Three-monthly confirmation + bulk tenant removal'
:as_owner
update public.unit_vehicle_status set confirmed_at = now() - interval '4 months' where unit_id = public._fvv('u1');
:as_r1
do $$ begin
  perform public._chk((public.my_vehicle_gate(public._fvv('soc'))->>'review_due')::boolean, 'review due after 3 months');
  perform public.snooze_vehicle_review(public._fvv('soc'));
  perform public._chk(not (public.my_vehicle_gate(public._fvv('soc'))->>'review_due')::boolean, 'remind-me-later hides it');
end $$;
:as_owner
update public.unit_vehicle_status set review_snoozed_until = null where unit_id = public._fvv('u1');
-- an untagged (older) vehicle blocks confirmation
insert into public.vehicles (society_id, unit_id, plate, plate_text, kind) values (public._fvv('soc'), public._fvv('u1'), 'DL01ZZ0001', 'DL01ZZ0001', 'car');
:as_r1
do $$ begin
  begin perform public.confirm_vehicles(public._fvv('soc')); perform public._chk(false, 'cannot confirm with an untagged vehicle');
  exception when sqlstate 'P0001' then null; end;
end $$;
select public.update_vehicle((select (d->>'id')::uuid from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'plate' = 'DL01ZZ0001'), 'DL01ZZ0001', 'car', null, null, 'owner');
select public.confirm_vehicles(public._fvv('soc'));
do $$ begin perform public._chk(not (public.my_vehicle_gate(public._fvv('soc'))->>'review_due')::boolean, 'confirming clears the review'); end $$;
:as_r2
do $$ begin begin perform public.remove_tenant_vehicles(public._fvv('soc'), public._fvv('u1')); perform public._chk(false, 'cannot clear another flat');
  exception when sqlstate '42501' then null; end; end $$;
:as_r1
do $$ declare n int; begin
  n := public.remove_tenant_vehicles(public._fvv('soc'), public._fvv('u1'));
  perform public._chk(n = 2, 'both tenant vehicles removed in one go');
  perform public._chk((select count(*) from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'unit_code' = 'P1-GF') = 2, 'owner vehicles kept');
  perform public._chk((select count(*) from jsonb_array_elements(public.vehicle_directory(public._fvv('soc'))) d where d->>'unit_code' = 'P1-GF' and d->>'holder' = 'tenant') = 0, 'no tenant vehicles left');
end $$;

\echo '7. Quarterly reminder (daily job)'
:as_owner
update public.unit_vehicle_status set confirmed_at = now() - interval '4 months', review_reminded_at = null where unit_id = public._fvv('u1');
select public._vehicle_review_reminders(public._fvv('soc')) as n1 \gset
select public._chk(:n1 >= 1, 'reminder sent to a flat whose review is due');
select public._chk((select count(*) from public.notifications where kind = 'vehicle_review' and user_id = public._fvv('r1')) = 1, 'the flat owner got the reminder');
select public._vehicle_review_reminders(public._fvv('soc')) as n2 \gset
select public._chk(:n2 = 0, 'not reminded again within 30 days');
select public._chk(not exists (select 1 from jsonb_array_elements(public.run_daily_jobs()) j where j ? 'error'), 'run_daily_jobs runs without errors');

\echo 'ALL fee + vehicle checks passed'
:as_owner
drop function public._chk(boolean, text);
drop function public._fvv(text);
drop table public._fv;
