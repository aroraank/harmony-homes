-- Harmony Homes — security guard maintenance rises from ₹800 to ₹1,000 per flat, plus the vehicle rules.
--
--  1. The "Security guard salary" recurring event moves to ₹1,000 per flat starting with the December 2026
--     event. Events already generated (up to and including November 2026) keep their own stored amount, so
--     nothing old changes. The change is recorded in the series history and nobody is billed differently.
--  2. A fee-change notice every flat must acknowledge (admins / super admins only see it and can close it).
--     Acknowledgements are recorded, admins are notified, and the home screen lists who has acknowledged.
--  3. Vehicles: every vehicle is tagged Owner or Tenant (kiraedaar); a flat may skip the "add your vehicles"
--     prompt 3 times, after which it must add a vehicle or say it has none; "no vehicle" is recorded and the
--     admins are notified; every 3 months the owner confirms the vehicles are still right, and can remove all
--     tenant vehicles in one go.
-- Safe to run once; every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 0. Helper: the flat of a resident login (admins / super admins are deliberately excluded)
-- ---------------------------------------------------------------------------
create or replace function public._resident_unit(p_society uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.unit_id from memberships m join profiles p on p.id = m.user_id
   where m.user_id = auth.uid() and m.society_id = p_society and m.status = 'active'
     and m.role = 'resident' and m.unit_id is not null and not p.must_change_password
   limit 1
$$;
revoke execute on function public._resident_unit(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Fee change notices + acknowledgements
-- ---------------------------------------------------------------------------
create table if not exists public.fee_changes (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  series_id uuid references public.event_series(id) on delete set null,
  title text not null,
  old_share_paise bigint not null check (old_share_paise > 0),
  new_share_paise bigint not null check (new_share_paise > 0),
  effective_from date not null,
  effective_period text not null check (public.is_valid_period(effective_period)),
  first_due_date date,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists fee_changes_series_period on public.fee_changes(series_id, effective_period);

create table if not exists public.fee_change_acks (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  fee_change_id uuid not null references public.fee_changes(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (fee_change_id, unit_id)
);

create table if not exists public.fee_change_admin_seen (
  fee_change_id uuid not null references public.fee_changes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (fee_change_id, user_id)
);

-- Per-flat vehicle registration state (skips, "no vehicle", 3-monthly confirmation)
create table if not exists public.unit_vehicle_status (
  unit_id uuid primary key references public.units(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  skips int not null default 0 check (skips between 0 and 3),
  no_vehicle boolean not null default false,
  no_vehicle_at timestamptz,
  no_vehicle_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  review_snoozed_until timestamptz,
  review_reminded_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.vehicles add column if not exists holder text;
do $$ begin
  alter table public.vehicles add constraint vehicles_holder_ok check (holder is null or holder in ('owner', 'tenant'));
exception when duplicate_object then null; end $$;

do $$
declare t text;
begin
  foreach t in array array['fee_changes', 'fee_change_acks', 'fee_change_admin_seen', 'unit_vehicle_status'] loop
    execute format('alter table public.%I enable row level security', t);
    -- no policies and no grants: these tables are reached only through the security-definer functions below
    execute format('drop trigger if exists zz_view_only_guard on public.%I', t);
    execute format('create trigger zz_view_only_guard before insert or update or delete on public.%I
                    for each statement execute function public.block_view_only_writes()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1a. ₹800 → ₹1,000 for the security guard recurring event, from the December 2026 event
-- ---------------------------------------------------------------------------
do $$
declare
  c_period    constant text   := '2026-12';
  c_effective constant date   := date '2026-12-01';
  c_share     constant bigint := 100000;   -- ₹1,000 per flat, in paise
  c_reason    constant text   := 'Security guard salary increased (new security guard).';
  s record; v_n int; v_rounding bigint; v_new bigint; v_old_share bigint; v_new_share bigint;
  v_first_due date; v_id uuid; v_all uuid[];
begin
  for s in select * from event_series where title ilike 'security guard salary%' loop
    if exists (select 1 from fee_changes where series_id = s.id and effective_period = c_period) then continue; end if;
    select count(*) into v_n from units u
     where u.society_id = s.society_id and u.is_billable
       and (s.scope_type = 'all' or u.unit_type_id = any(s.scope_unit_type_ids));
    if v_n = 0 then continue; end if;
    select share_rounding_paise into v_rounding from society_settings where society_id = s.society_id;
    v_new := c_share * v_n;
    v_old_share := public.event_share_paise(s.total_cost_paise, v_n, v_rounding);
    v_new_share := public.event_share_paise(v_new, v_n, v_rounding);
    if exists (select 1 from events where series_id = s.id and series_period = c_period) then
      raise notice 'The % event already exists for %: it keeps its amount. Change it from Recurring events instead.', c_period, s.title;
      continue;
    end if;
    -- the change takes effect for the December 2026 event onward; earlier events are untouched
    update event_series set pending_total_paise = v_new, pending_from_period = c_period where id = s.id;
    insert into event_series_versions (society_id, series_id, total_cost_paise, effective_period, reason)
    values (s.society_id, s.id, v_new, c_period, c_reason);
    v_first_due := (make_date(2026, 12, s.due_day) + make_interval(months => s.due_month_offset))::date;
    insert into fee_changes (society_id, series_id, title, old_share_paise, new_share_paise, effective_from,
                             effective_period, first_due_date, reason)
    values (s.society_id, s.id, s.title, v_old_share, v_new_share, c_effective, c_period, v_first_due, c_reason)
    returning id into v_id;
    v_all := public._all_member_ids(s.society_id);
    perform public._notify(s.society_id, v_all, 'fee_change', v_id,
      format('Security guard maintenance: %s → %s from 1 December 2026', public.fmt_inr(v_old_share), public.fmt_inr(v_new_share)),
      format('Monthly security guard maintenance goes up by %s per flat because of the new security guard''s higher salary. Open the app to read and acknowledge.',
             public.fmt_inr(v_new_share - v_old_share)), '/');
    raise notice 'Security guard share % -> % from %, notified % people.', v_old_share, v_new_share, c_period, coalesce(array_length(v_all, 1), 0);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1b. Fee change popup + acknowledgement RPCs
-- ---------------------------------------------------------------------------
create or replace function public._fee_change_json(r public.fee_changes) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'old_share_paise', r.old_share_paise,
    'new_share_paise', r.new_share_paise, 'increase_paise', r.new_share_paise - r.old_share_paise,
    'effective_from', r.effective_from, 'effective_period', r.effective_period, 'first_due_date', r.first_due_date)
$$;
revoke execute on function public._fee_change_json(public.fee_changes) from public, anon, authenticated;

create or replace function public.my_fee_change_prompt(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := public.my_role(p_society); v_unit uuid; r public.fee_changes;
begin
  if v_role is null then return jsonb_build_object('show', false); end if;
  if v_role in ('admin', 'super_admin') then
    select * into r from fee_changes fc
     where fc.society_id = p_society
       and not exists (select 1 from fee_change_admin_seen s where s.fee_change_id = fc.id and s.user_id = auth.uid())
     order by fc.created_at limit 1;
    if r.id is null then return jsonb_build_object('show', false); end if;
    return jsonb_build_object('show', true, 'mode', 'admin', 'change', public._fee_change_json(r),
      'acknowledged', (select count(*) from fee_change_acks a where a.fee_change_id = r.id),
      'total_flats', (select count(*) from units u where u.society_id = p_society and u.is_billable));
  end if;
  v_unit := public._resident_unit(p_society);
  if v_unit is null then return jsonb_build_object('show', false); end if;
  select * into r from fee_changes fc
   where fc.society_id = p_society
     and not exists (select 1 from fee_change_acks a where a.fee_change_id = fc.id and a.unit_id = v_unit)
   order by fc.created_at limit 1;
  if r.id is null then return jsonb_build_object('show', false); end if;
  return jsonb_build_object('show', true, 'mode', 'resident', 'change', public._fee_change_json(r),
    'unit_code', (select code from units where id = v_unit));
end $$;

create or replace function public.acknowledge_fee_change(p_fee_change_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fee_changes; v_unit uuid; v_code text; v_name text; v_rows int;
begin
  select * into r from fee_changes where id = p_fee_change_id;
  if r.id is null then raise exception using errcode = 'P0001', message = 'Notice not found.'; end if;
  perform public.assert_member(r.society_id);
  v_unit := public._resident_unit(r.society_id);
  if v_unit is null then
    raise exception using errcode = '42501', message = 'Only a flat member can acknowledge this notice.';
  end if;
  insert into fee_change_acks (society_id, fee_change_id, unit_id, user_id)
  values (r.society_id, r.id, v_unit, auth.uid()) on conflict (fee_change_id, unit_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return; end if;
  select code, display_name into v_code, v_name from units where id = v_unit;
  perform public._notify(r.society_id, public._admin_ids(r.society_id), 'fee_change_ack', v_unit,
    format('%s acknowledged the security guard maintenance increase', coalesce(v_code, v_name)),
    format('%s → %s per month, from %s.', public.fmt_inr(r.old_share_paise), public.fmt_inr(r.new_share_paise), to_char(r.effective_from, 'FMDD FMMonth YYYY')),
    '/');
  perform public.audit_append(r.society_id, 'fee_change_acknowledged', 'fee_change_acks', v_unit::text, null,
    jsonb_build_object('fee_change_id', r.id, 'unit', coalesce(v_code, v_name), 'new_share_paise', r.new_share_paise));
end $$;

create or replace function public.mark_fee_change_seen_by_admin(p_fee_change_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.fee_changes;
begin
  select * into r from fee_changes where id = p_fee_change_id;
  if r.id is null then return; end if;
  if not public.is_admin(r.society_id) then
    raise exception using errcode = '42501', message = 'Only an admin can do this.';
  end if;
  insert into fee_change_admin_seen (fee_change_id, user_id) values (r.id, auth.uid()) on conflict do nothing;
end $$;

-- Admin home card: who has acknowledged and who has not
create or replace function public.fee_change_overview(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only an admin can see this.';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'created_at') desc) from (
      select jsonb_build_object(
        'id', fc.id, 'title', fc.title, 'old_share_paise', fc.old_share_paise, 'new_share_paise', fc.new_share_paise,
        'effective_from', fc.effective_from, 'created_at', fc.created_at,
        'flats', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'unit_id', u.id, 'code', u.code, 'name', u.display_name,
                   'status', case when a.id is not null then 'acknowledged'
                                  when exists (select 1 from memberships mm join fee_change_admin_seen sn
                                                 on sn.user_id = mm.user_id and sn.fee_change_id = fc.id
                                                where mm.unit_id = u.id and mm.status = 'active'
                                                  and mm.role in ('admin', 'super_admin')) then 'seen_by_admin'
                                  else 'pending' end,
                   'at', a.acknowledged_at,
                   'who', (select p.full_name from profiles p where p.id = a.user_id)) order by u.sort_order, u.code)
            from units u left join fee_change_acks a on a.fee_change_id = fc.id and a.unit_id = u.id
           where u.society_id = fc.society_id and u.is_billable), '[]'::jsonb)) as x
      from fee_changes fc where fc.society_id = p_society order by fc.created_at desc limit 3) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Vehicles: owner / tenant tag, skips, "no vehicle", 3-monthly confirmation
-- ---------------------------------------------------------------------------
create or replace function public._ensure_vehicle_status(p_unit uuid) returns void
language sql security definer set search_path = public as $$
  insert into unit_vehicle_status (unit_id, society_id) select id, society_id from units where id = p_unit
  on conflict (unit_id) do nothing
$$;
revoke execute on function public._ensure_vehicle_status(uuid) from public, anon, authenticated;

-- Replace add_vehicle / update_vehicle so each vehicle carries Owner or Tenant
drop function if exists public.add_vehicle(uuid, uuid, text, text, text, text);
drop function if exists public.update_vehicle(uuid, text, text, text, text);

create or replace function public.add_vehicle(
  p_society uuid, p_unit_id uuid, p_plate text, p_kind text, p_model text default null, p_color text default null,
  p_holder text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_plate text := public.norm_plate(p_plate); v_id uuid; v_owner text;
begin
  perform public.assert_member(p_society);
  if p_unit_id is null or not exists (select 1 from units where id = p_unit_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a flat.';
  end if;
  if not public._vehicle_can_edit(p_society, p_unit_id) then
    raise exception using errcode = '42501', message = 'You can only add vehicles for your own flat.';
  end if;
  if coalesce(p_kind, '') not in ('car', 'bike', 'scooter', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose car, bike, scooter or other.';
  end if;
  if coalesce(p_holder, '') not in ('owner', 'tenant') then
    raise exception using errcode = 'P0001', message = 'Say whether this vehicle belongs to the owner or a tenant.';
  end if;
  select u.code into v_owner from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  if v_owner is not null then
    raise exception using errcode = 'P0001', message = format('%s is already added for %s.', v_plate, v_owner);
  end if;
  if (select count(*) from vehicles where unit_id = p_unit_id) >= 10 then
    raise exception using errcode = 'P0001', message = 'A flat can have at most 10 vehicles.';
  end if;
  insert into vehicles (society_id, unit_id, plate, plate_text, kind, model, color, holder, added_by)
  values (p_society, p_unit_id, v_plate, coalesce(public.plate_text(p_plate), v_plate), p_kind,
          left(public.clean_text(p_model), 30), left(public.clean_text(p_color), 20), p_holder, auth.uid())
  returning id into v_id;
  perform public._ensure_vehicle_status(p_unit_id);
  update unit_vehicle_status
     set no_vehicle = false, no_vehicle_at = null, no_vehicle_by = null,
         confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
   where unit_id = p_unit_id;
  update profiles set vehicle_prompt_at = now() where id = auth.uid() and vehicle_prompt_at is null;
  return v_id;
end $$;

create or replace function public.update_vehicle(
  p_vehicle_id uuid, p_plate text, p_kind text, p_model text default null, p_color text default null,
  p_holder text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v record; v_plate text := public.norm_plate(p_plate); v_owner text;
begin
  select * into v from vehicles where id = p_vehicle_id;
  if not found then raise exception using errcode = 'P0001', message = 'Vehicle not found.'; end if;
  perform public.assert_member(v.society_id);
  if not public._vehicle_can_edit(v.society_id, v.unit_id) then
    raise exception using errcode = '42501', message = 'You can only change vehicles of your own flat.';
  end if;
  if coalesce(p_kind, '') not in ('car', 'bike', 'scooter', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose car, bike, scooter or other.';
  end if;
  if p_holder is not null and p_holder not in ('owner', 'tenant') then
    raise exception using errcode = 'P0001', message = 'Say whether this vehicle belongs to the owner or a tenant.';
  end if;
  select u.code into v_owner from vehicles x join units u on u.id = x.unit_id
   where x.society_id = v.society_id and x.plate = v_plate and x.id <> p_vehicle_id limit 1;
  if v_owner is not null then
    raise exception using errcode = 'P0001', message = format('%s is already added for %s.', v_plate, v_owner);
  end if;
  update vehicles
     set plate = v_plate, plate_text = coalesce(public.plate_text(p_plate), v_plate), kind = p_kind,
         model = left(public.clean_text(p_model), 30), color = left(public.clean_text(p_color), 20),
         holder = coalesce(p_holder, holder), updated_at = now()
   where id = p_vehicle_id;
end $$;

-- Directory now also shows the Owner / Tenant tag
create or replace function public.vehicle_directory(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'plate', v.plate, 'plate_text', v.plate_text, 'kind', v.kind, 'model', v.model,
             'color', v.color, 'holder', v.holder, 'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
             'owner_name', (select p.full_name from memberships mm join profiles p on p.id = mm.user_id
                             where mm.unit_id = u.id and mm.status = 'active' limit 1),
             'can_edit', public._vehicle_can_edit(p_society, u.id))
           order by u.sort_order, u.code, v.plate)
      from vehicles v join units u on u.id = v.unit_id
     where v.society_id = p_society), '[]'::jsonb);
end $$;

-- What the app needs to decide which vehicle popup (if any) to show this flat
create or replace function public.my_vehicle_gate(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit uuid := public._resident_unit(p_society); st public.unit_vehicle_status;
        v_count int; v_untagged int; v_tenant int; v_state text; v_due boolean;
begin
  if v_unit is null then return jsonb_build_object('applies', false); end if;
  select * into st from unit_vehicle_status where unit_id = v_unit;
  select count(*), count(*) filter (where holder is null), count(*) filter (where holder = 'tenant')
    into v_count, v_untagged, v_tenant from vehicles where unit_id = v_unit;
  v_state := case when v_count > 0 or coalesce(st.no_vehicle, false) then 'done'
                  when coalesce(st.skips, 0) >= 3 then 'force' else 'ask' end;
  v_due := v_state = 'done'
           and (st.confirmed_at is null or st.confirmed_at < now() - interval '3 months')
           and (st.review_snoozed_until is null or st.review_snoozed_until < now());
  return jsonb_build_object('applies', true, 'unit_id', v_unit,
    'unit_code', (select code from units where id = v_unit), 'unit_name', (select display_name from units where id = v_unit),
    'state', v_state, 'skips_used', coalesce(st.skips, 0), 'skips_left', greatest(0, 3 - coalesce(st.skips, 0)),
    'max_skips', 3, 'no_vehicle', coalesce(st.no_vehicle, false), 'review_due', v_due,
    'vehicle_count', v_count, 'untagged_count', v_untagged, 'tenant_count', v_tenant,
    'last_confirmed_at', st.confirmed_at);
end $$;

create or replace function public.skip_vehicle_prompt(p_society uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_unit uuid := public._resident_unit(p_society); st public.unit_vehicle_status;
begin
  if v_unit is null then raise exception using errcode = '42501', message = 'Only a flat member can do this.'; end if;
  perform public._ensure_vehicle_status(v_unit);
  select * into st from unit_vehicle_status where unit_id = v_unit for update;
  if st.no_vehicle or exists (select 1 from vehicles where unit_id = v_unit) then
    return jsonb_build_object('skips_left', greatest(0, 3 - st.skips));
  end if;
  if st.skips >= 3 then
    raise exception using errcode = 'P0001', message = 'Please add your vehicle, or tell us you do not have one.';
  end if;
  update unit_vehicle_status set skips = skips + 1, updated_at = now() where unit_id = v_unit;
  return jsonb_build_object('skips_left', greatest(0, 3 - (st.skips + 1)));
end $$;

create or replace function public.declare_no_vehicle(p_society uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_unit uuid := public._resident_unit(p_society); v_code text; v_name text; v_who text;
begin
  if v_unit is null then raise exception using errcode = '42501', message = 'Only a flat member can do this.'; end if;
  if exists (select 1 from vehicles where unit_id = v_unit) then
    raise exception using errcode = 'P0001', message = 'Your flat already has vehicles. Remove them first if you no longer have any.';
  end if;
  perform public._ensure_vehicle_status(v_unit);
  update unit_vehicle_status
     set no_vehicle = true, no_vehicle_at = now(), no_vehicle_by = auth.uid(), confirmed_at = now(),
         review_snoozed_until = null, updated_at = now()
   where unit_id = v_unit;
  select code, display_name into v_code, v_name from units where id = v_unit;
  select full_name into v_who from profiles where id = auth.uid();
  perform public._notify(p_society, public._admin_ids(p_society), 'no_vehicle_declared', v_unit,
    format('%s has no vehicle', coalesce(v_code, v_name)),
    format('%s marked "I do not have any vehicle" for this flat.', coalesce(v_who, 'A member')), '/vehicles');
  perform public.audit_append(p_society, 'no_vehicle_declared', 'unit_vehicle_status', v_unit::text, null,
    jsonb_build_object('unit', coalesce(v_code, v_name), 'declared_by', v_who));
end $$;

create or replace function public.confirm_vehicles(p_society uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_unit uuid := public._resident_unit(p_society);
begin
  if v_unit is null then raise exception using errcode = '42501', message = 'Only a flat member can do this.'; end if;
  if exists (select 1 from vehicles where unit_id = v_unit and holder is null) then
    raise exception using errcode = 'P0001', message = 'Mark each vehicle as Owner or Tenant first.';
  end if;
  perform public._ensure_vehicle_status(v_unit);
  update unit_vehicle_status set confirmed_at = now(), review_snoozed_until = null, updated_at = now() where unit_id = v_unit;
end $$;

create or replace function public.snooze_vehicle_review(p_society uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_unit uuid := public._resident_unit(p_society);
begin
  if v_unit is null then raise exception using errcode = '42501', message = 'Only a flat member can do this.'; end if;
  perform public._ensure_vehicle_status(v_unit);
  update unit_vehicle_status set review_snoozed_until = now() + interval '3 days', updated_at = now() where unit_id = v_unit;
end $$;

-- Bulk: remove every tenant vehicle of a flat (tenants moved out)
create or replace function public.remove_tenant_vehicles(p_society uuid, p_unit_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int; v_code text;
begin
  perform public.assert_member(p_society);
  if not exists (select 1 from units where id = p_unit_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Flat not found.';
  end if;
  if not public._vehicle_can_edit(p_society, p_unit_id) then
    raise exception using errcode = '42501', message = 'You can only change vehicles of your own flat.';
  end if;
  delete from vehicles where unit_id = p_unit_id and holder = 'tenant';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    select code into v_code from units where id = p_unit_id;
    perform public.audit_append(p_society, 'tenant_vehicles_removed', 'vehicles', p_unit_id::text, null,
      jsonb_build_object('unit', v_code, 'removed', v_n));
  end if;
  return v_n;
end $$;

-- Admin home card: vehicle registration across all flats
create or replace function public.vehicle_compliance(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_flats jsonb;
begin
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only an admin can see this.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'unit_id', u.id, 'code', u.code, 'name', u.display_name,
           'status', case when vc.n > 0 then 'has_vehicles' when coalesce(s.no_vehicle, false) then 'no_vehicle' else 'pending' end,
           'vehicle_count', vc.n, 'tenant_count', vc.t, 'skips_used', coalesce(s.skips, 0),
           'no_vehicle_at', s.no_vehicle_at, 'confirmed_at', s.confirmed_at) order by u.sort_order, u.code), '[]'::jsonb)
    into v_flats
    from units u
    left join unit_vehicle_status s on s.unit_id = u.id
    left join lateral (select count(*) n, count(*) filter (where holder = 'tenant') t from vehicles v where v.unit_id = u.id) vc on true
   where u.society_id = p_society and u.is_billable;
  return jsonb_build_object('flats', v_flats);
end $$;

-- 3-monthly reminder to confirm vehicles (called by the daily job)
create or replace function public._vehicle_review_reminders(p_society uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_n int := 0; v_users uuid[];
begin
  for r in
    select u.id as unit_id, u.code
      from units u left join unit_vehicle_status s on s.unit_id = u.id
     where u.society_id = p_society and u.is_billable
       and (exists (select 1 from vehicles v where v.unit_id = u.id) or coalesce(s.no_vehicle, false))
       and (s.confirmed_at is null or s.confirmed_at < now() - interval '3 months')
       and (s.review_reminded_at is null or s.review_reminded_at < now() - interval '30 days')
  loop
    select coalesce(array_agg(user_id), '{}') into v_users from memberships
     where unit_id = r.unit_id and status = 'active' and role = 'resident';
    if coalesce(array_length(v_users, 1), 0) = 0 then continue; end if;
    perform public._notify(p_society, v_users, 'vehicle_review', r.unit_id,
      'Please confirm your flat''s vehicles',
      'Check that the vehicles listed are still right. If tenants have changed, remove the old tenant vehicles and add the new ones.', '/vehicles');
    perform public._ensure_vehicle_status(r.unit_id);
    update unit_vehicle_status set review_reminded_at = now() where unit_id = r.unit_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public._vehicle_review_reminders(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Daily job: unchanged except it now also sends the 3-monthly vehicle reminders
--    (body copied from 20261017000001; the reminder call is wrapped so it can never break the rest)
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int; v_activated int;
        v_visits int; v_vrev int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days, st.monthly_dues_enabled,
                  st.visitor_log_retention_days
             from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0; v_activated := 0; v_visits := 0; v_vrev := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if s.monthly_dues_enabled and v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_series := public._generate_series_events(s.id);
      v_activated := public._activate_due_series_events(s.id);
      v_drafts := public._generate_expense_drafts(s.id, v_period, false);
      if v_drafts > 0 then
        perform public._notify(s.id, public._perm_user_ids(s.id, 'record_expense'), 'expense_drafts', null,
          format('%s recurring expense(s) ready to confirm', v_drafts), 'Tap to review and confirm.', '/admin/expenses');
      end if;
      v_rem := public._run_reminders(s.id);
      update notice_receipts set ack_lat = null, ack_lng = null, ack_accuracy = null
       where society_id = s.id and ack_lat is not null
         and acknowledged_at < now() - make_interval(days => s.location_retention_days);
      get diagnostics v_purged = row_count;
      delete from gate_visits
       where society_id = s.id and in_at < now() - make_interval(days => s.visitor_log_retention_days);
      get diagnostics v_visits = row_count;
      begin
        v_vrev := public._vehicle_review_reminders(s.id);
      exception when others then
        v_vrev := -1;
      end;
    exception when others then
      v_out := v_out || jsonb_build_object('society_id', s.id, 'error', sqlerrm);
      continue;
    end;
    v_out := v_out || jsonb_build_object('society_id', s.id, 'dues', v_dues, 'drafts', v_drafts, 'reminders', v_rem,
                                         'recurring_events', v_series, 'activated_events', v_activated,
                                         'locations_purged', v_purged, 'gate_visits_purged', v_visits,
                                         'vehicle_reviews', v_vrev);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.my_fee_change_prompt(uuid)', 'public.acknowledge_fee_change(uuid)',
    'public.mark_fee_change_seen_by_admin(uuid)', 'public.fee_change_overview(uuid)',
    'public.add_vehicle(uuid, uuid, text, text, text, text, text)', 'public.update_vehicle(uuid, text, text, text, text, text)',
    'public.vehicle_directory(uuid)', 'public.my_vehicle_gate(uuid)', 'public.skip_vehicle_prompt(uuid)',
    'public.declare_no_vehicle(uuid)', 'public.confirm_vehicles(uuid)', 'public.snooze_vehicle_review(uuid)',
    'public.remove_tenant_vehicles(uuid, uuid)', 'public.vehicle_compliance(uuid)']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function public.run_daily_jobs() to service_role;
