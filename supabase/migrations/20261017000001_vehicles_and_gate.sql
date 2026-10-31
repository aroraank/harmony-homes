-- Harmony Homes — vehicles directory + gate (security guard) panel
--
--   1. vehicles      — each flat's own cars / bikes / scooters, visible to every member so
--                      anyone can find out whose vehicle is parked where.
--   2. gate_visits   — guest (non-society) vehicles: IN time, flat being visited, OUT time.
--                      Purged automatically after society_settings.visitor_log_retention_days.
--   3. guards        — gate logins. A guard is deliberately NOT a membership: they can read
--                      nothing in the society (no dues, no money, no contacts). Everything the
--                      gate panel does goes through the security definer RPCs below.

-- ---------------------------------------------------------------------------
-- Settings + profile additions
-- ---------------------------------------------------------------------------
alter table public.society_settings
  add column if not exists visitor_log_retention_days int not null default 15;
do $$ begin
  alter table public.society_settings add constraint society_settings_visitor_retention_ok
    check (visitor_log_retention_days between 3 and 60);
exception when duplicate_object then null; end $$;

-- when the member last dismissed (or answered) the "add your vehicles" popup
alter table public.profiles add column if not exists vehicle_prompt_at timestamptz;

-- ---------------------------------------------------------------------------
-- Plate helpers
-- ---------------------------------------------------------------------------
-- Matching key: upper case, letters and digits only ("CH 04 7669" -> "CH047669").
create or replace function public.norm_plate(p_plate text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if v = '' then
    raise exception using errcode = 'P0001', message = 'Enter the vehicle number.';
  end if;
  if char_length(v) < 4 or char_length(v) > 13 then
    raise exception using errcode = 'P0001', message = 'A vehicle number is 4 to 13 letters and digits, like CH01AB1234.';
  end if;
  if v !~ '[A-Z]' or v !~ '[0-9]' then
    raise exception using errcode = 'P0001', message = 'A vehicle number has both letters and digits, like CH01AB1234.';
  end if;
  return v;
end $$;

-- What is shown on screen: exactly what was typed, upper case, single spaces.
create or replace function public.plate_text(p_plate text) returns text
language sql immutable set search_path = public as $$
  select left(upper(public.clean_text(p_plate)), 20)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  plate text not null check (plate ~ '^[A-Z0-9]{4,13}$'),
  plate_text text not null check (char_length(plate_text) between 4 and 20),
  kind text not null check (kind in ('car', 'bike', 'scooter', 'other')),
  model text check (model is null or char_length(model) between 1 and 30),
  color text check (color is null or char_length(color) between 1 and 20),
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists vehicles_plate_unique on public.vehicles(society_id, plate);
create index if not exists vehicles_unit_idx on public.vehicles(unit_id);

create table if not exists public.gate_visits (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  plate text not null check (plate ~ '^[A-Z0-9]{4,13}$'),
  plate_text text not null,
  unit_id uuid references public.units(id) on delete set null,
  in_at timestamptz not null default now(),
  out_at timestamptz,
  in_by uuid references public.profiles(id),
  out_by uuid references public.profiles(id),
  note text check (note is null or char_length(note) <= 120),
  created_at timestamptz not null default now(),
  check (out_at is null or out_at >= in_at)
);
create index if not exists gate_visits_society_idx on public.gate_visits(society_id, in_at desc);
create index if not exists gate_visits_unit_idx on public.gate_visits(unit_id, in_at desc);
-- one vehicle cannot be inside twice
create unique index if not exists gate_visits_one_open on public.gate_visits(society_id, plate) where out_at is null;

create table if not exists public.guards (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  disabled_at timestamptz
);
create unique index if not exists guards_one_per_user on public.guards(user_id);
create index if not exists guards_society_idx on public.guards(society_id, status);

alter table public.vehicles enable row level security;
alter table public.gate_visits enable row level security;
alter table public.guards enable row level security;

grant select on public.vehicles to authenticated;
grant select on public.gate_visits to authenticated;
grant select on public.guards to authenticated;

-- Every member can look up any vehicle in their own society (that is the point of the directory).
drop policy if exists vehicle_read on public.vehicles;
create policy vehicle_read on public.vehicles for select to authenticated
  using (public.is_member(society_id));

-- The guest log is an admin / super admin record; guards reach it only through the RPCs below.
drop policy if exists gate_visit_read on public.gate_visits;
create policy gate_visit_read on public.gate_visits for select to authenticated
  using (public.is_admin(society_id));

drop policy if exists guard_read on public.guards;
create policy guard_read on public.guards for select to authenticated
  using (public.is_admin(society_id));

-- ---------------------------------------------------------------------------
-- Who is a guard
-- ---------------------------------------------------------------------------
create or replace function public.is_guard(p_society uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guards g join profiles p on p.id = g.user_id
     where g.user_id = auth.uid() and g.society_id = p_society
       and g.status = 'active' and not p.must_change_password)
$$;

create or replace function public.assert_guard(p_society uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in again.';
  end if;
  if not public.is_guard(p_society) then
    raise exception using errcode = '42501', message = 'This is the gate panel. Your login cannot use it.';
  end if;
end $$;

-- gate screens are used by the guard and by admins (so an admin can check or correct the log)
create or replace function public.assert_gate_user(p_society uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in again.';
  end if;
  if public.is_guard(p_society) then return 'guard'; end if;
  if public.is_admin(p_society) then return 'admin'; end if;
  raise exception using errcode = '42501', message = 'You do not have permission to do this.';
end $$;

-- ---------------------------------------------------------------------------
-- Context: tell the app that this login is a gate login
-- ---------------------------------------------------------------------------
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_profile jsonb; v_memberships jsonb; v_guard jsonb;
begin
  if v_uid is null then return null; end if;
  select to_jsonb(p) - 'avatar_path' into v_profile from profiles p where p.id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id, 'society_id', s.id, 'society_name', s.name, 'society_slug', s.slug,
           'role', m.role, 'status', m.status, 'unit_id', m.unit_id, 'unit_code', u.code,
           'unit_name', u.display_name, 'unit_type_id', u.unit_type_id,
           'permissions', (select coalesce(jsonb_agg(p.perm), '[]'::jsonb) from unnest(public.permission_catalogue()) p(perm)
                            where public.user_has_perm(v_uid, s.id, p.perm) or (m.role = 'super_admin' and m.status = 'active'))
         ) order by s.name), '[]'::jsonb)
    into v_memberships
    from memberships m join societies s on s.id = m.society_id left join units u on u.id = m.unit_id
   where m.user_id = v_uid and m.status <> 'deactivated';
  select jsonb_build_object('guard_id', g.id, 'society_id', s.id, 'society_name', s.name, 'society_slug', s.slug,
                            'status', g.status)
    into v_guard
    from guards g join societies s on s.id = g.society_id
   where g.user_id = v_uid and g.status = 'active' limit 1;
  return jsonb_build_object('user_id', v_uid, 'profile', v_profile, 'memberships', v_memberships, 'guard', v_guard);
end $$;

-- ---------------------------------------------------------------------------
-- Gate panel RPCs
-- ---------------------------------------------------------------------------
-- The list of flats shown as big buttons, in the same order as everywhere else.
create or replace function public.gate_flats(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_gate_user(p_society);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', u.id, 'code', u.code, 'name', u.display_name)
                     order by u.sort_order, u.code)
      from units u where u.society_id = p_society), '[]'::jsonb);
end $$;

-- Type a number -> is it one of ours, and is it already inside?
create or replace function public.gate_lookup(p_society uuid, p_plate text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_plate text := public.norm_plate(p_plate); v_res jsonb; v_open jsonb; v_last jsonb;
begin
  perform public.assert_gate_user(p_society);
  select jsonb_build_object('vehicle_id', v.id, 'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
                            'kind', v.kind, 'model', v.model, 'color', v.color, 'plate_text', v.plate_text)
    into v_res
    from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  select jsonb_build_object('id', g.id, 'in_at', g.in_at, 'unit_id', g.unit_id, 'unit_code', u.code,
                            'unit_name', u.display_name, 'plate_text', g.plate_text, 'note', g.note)
    into v_open
    from gate_visits g left join units u on u.id = g.unit_id
   where g.society_id = p_society and g.plate = v_plate and g.out_at is null limit 1;
  select jsonb_build_object('in_at', g.in_at, 'out_at', g.out_at, 'unit_code', u.code, 'unit_name', u.display_name)
    into v_last
    from gate_visits g left join units u on u.id = g.unit_id
   where g.society_id = p_society and g.plate = v_plate and g.out_at is not null
   order by g.in_at desc limit 1;
  return jsonb_build_object('plate', v_plate, 'plate_text', coalesce(public.plate_text(p_plate), v_plate),
                            'resident', v_res, 'open_visit', v_open, 'last_visit', v_last);
end $$;

-- Guest vehicle comes in.
create or replace function public.gate_check_in(p_society uuid, p_plate text, p_unit_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plate text := public.norm_plate(p_plate); v_id uuid; v_code text; v_open timestamptz;
begin
  perform public.assert_gate_user(p_society);
  select u.code into v_code from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  if v_code is not null then
    raise exception using errcode = 'P0001',
      message = format('%s belongs to %s. No entry is needed for society vehicles.', v_plate, v_code);
  end if;
  select in_at into v_open from gate_visits
   where society_id = p_society and plate = v_plate and out_at is null limit 1;
  if v_open is not null then
    raise exception using errcode = 'P0001', message = 'This vehicle is already marked IN. Mark it OUT first.';
  end if;
  if p_unit_id is not null and not exists (select 1 from units where id = p_unit_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a flat from the list.';
  end if;
  insert into gate_visits (society_id, plate, plate_text, unit_id, in_by, note)
  values (p_society, v_plate, coalesce(public.plate_text(p_plate), v_plate), p_unit_id, auth.uid(),
          left(public.clean_text(p_note), 120))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'plate', v_plate);
end $$;

-- Guest vehicle leaves.
create or replace function public.gate_check_out(p_visit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from gate_visits where id = p_visit_id;
  if not found then raise exception using errcode = 'P0001', message = 'Entry not found.'; end if;
  perform public.assert_gate_user(v.society_id);
  if v.out_at is not null then
    raise exception using errcode = 'P0001', message = 'This vehicle is already marked OUT.';
  end if;
  update gate_visits set out_at = now(), out_by = auth.uid() where id = p_visit_id;
end $$;

-- Change the flat on an open entry (the guard tapped the wrong one).
create or replace function public.gate_set_flat(p_visit_id uuid, p_unit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from gate_visits where id = p_visit_id;
  if not found then raise exception using errcode = 'P0001', message = 'Entry not found.'; end if;
  perform public.assert_gate_user(v.society_id);
  if v.out_at is not null then
    raise exception using errcode = 'P0001', message = 'This visit is finished and cannot be changed.';
  end if;
  if p_unit_id is not null and not exists (select 1 from units where id = p_unit_id and society_id = v.society_id) then
    raise exception using errcode = 'P0001', message = 'Choose a flat from the list.';
  end if;
  update gate_visits set unit_id = p_unit_id where id = p_visit_id;
end $$;

-- Everything the gate screen shows: who is inside now, and what went out today.
create or replace function public.gate_board(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open jsonb; v_recent jsonb; v_in_today int;
begin
  perform public.assert_gate_user(p_society);
  select coalesce(jsonb_agg(x order by x->>'in_at' desc), '[]'::jsonb) into v_open from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is null) s;
  select coalesce(jsonb_agg(x order by x->>'out_at' desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at, 'out_at', g.out_at,
                              'unit_code', u.code, 'unit_name', u.display_name) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is not null and g.out_at > now() - interval '12 hours'
     order by g.out_at desc limit 15) s;
  select count(*) into v_in_today from gate_visits
   where society_id = p_society and (in_at at time zone 'Asia/Kolkata')::date = public.ist_today();
  return jsonb_build_object('inside', v_open, 'recent_out', v_recent, 'in_today', v_in_today,
                            'society_name', (select name from societies where id = p_society));
end $$;

-- ---------------------------------------------------------------------------
-- Member vehicles
-- ---------------------------------------------------------------------------
create or replace function public._vehicle_can_edit(p_society uuid, p_unit uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin(p_society) or p_unit in (select public.my_unit_ids(p_society))
$$;

create or replace function public.add_vehicle(
  p_society uuid, p_unit_id uuid, p_plate text, p_kind text, p_model text default null, p_color text default null
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
  select u.code into v_owner from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  if v_owner is not null then
    raise exception using errcode = 'P0001', message = format('%s is already added for %s.', v_plate, v_owner);
  end if;
  if (select count(*) from vehicles where unit_id = p_unit_id) >= 10 then
    raise exception using errcode = 'P0001', message = 'A flat can have at most 10 vehicles.';
  end if;
  insert into vehicles (society_id, unit_id, plate, plate_text, kind, model, color, added_by)
  values (p_society, p_unit_id, v_plate, coalesce(public.plate_text(p_plate), v_plate), p_kind,
          left(public.clean_text(p_model), 30), left(public.clean_text(p_color), 20), auth.uid())
  returning id into v_id;
  update profiles set vehicle_prompt_at = now() where id = auth.uid() and vehicle_prompt_at is null;
  return v_id;
end $$;

create or replace function public.update_vehicle(
  p_vehicle_id uuid, p_plate text, p_kind text, p_model text default null, p_color text default null
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
  select u.code into v_owner from vehicles x join units u on u.id = x.unit_id
   where x.society_id = v.society_id and x.plate = v_plate and x.id <> p_vehicle_id limit 1;
  if v_owner is not null then
    raise exception using errcode = 'P0001', message = format('%s is already added for %s.', v_plate, v_owner);
  end if;
  update vehicles
     set plate = v_plate, plate_text = coalesce(public.plate_text(p_plate), v_plate), kind = p_kind,
         model = left(public.clean_text(p_model), 30), color = left(public.clean_text(p_color), 20), updated_at = now()
   where id = p_vehicle_id;
end $$;

create or replace function public.remove_vehicle(p_vehicle_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from vehicles where id = p_vehicle_id;
  if not found then return; end if;
  perform public.assert_member(v.society_id);
  if not public._vehicle_can_edit(v.society_id, v.unit_id) then
    raise exception using errcode = '42501', message = 'You can only remove vehicles of your own flat.';
  end if;
  delete from vehicles where id = p_vehicle_id;
end $$;

-- Who owns this vehicle? Any member can look the whole society up.
create or replace function public.vehicle_directory(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'plate', v.plate, 'plate_text', v.plate_text, 'kind', v.kind, 'model', v.model,
             'color', v.color, 'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
             'owner_name', (select p.full_name from memberships mm join profiles p on p.id = mm.user_id
                             where mm.unit_id = u.id and mm.status = 'active' limit 1),
             'can_edit', public._vehicle_can_edit(p_society, u.id))
           order by u.sort_order, u.code, v.plate)
      from vehicles v join units u on u.id = v.unit_id
     where v.society_id = p_society), '[]'::jsonb);
end $$;

-- Popup: ask a member once to add their vehicles.
create or replace function public.my_vehicle_prompt(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit uuid; v_show boolean;
begin
  if public.my_role(p_society) is null then return jsonb_build_object('show', false); end if;
  select unit_id into v_unit from memberships
   where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null limit 1;
  if v_unit is null then return jsonb_build_object('show', false); end if;
  v_show := (select vehicle_prompt_at is null from profiles where id = auth.uid())
            and not exists (select 1 from vehicles where unit_id = v_unit);
  return jsonb_build_object('show', coalesce(v_show, false), 'unit_id', v_unit,
    'unit_code', (select code from units where id = v_unit),
    'unit_name', (select display_name from units where id = v_unit));
end $$;

create or replace function public.dismiss_vehicle_prompt() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  update profiles set vehicle_prompt_at = now() where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
-- Visitor log for admins / super admin (with filters)
-- ---------------------------------------------------------------------------
create or replace function public.visitor_log(
  p_society uuid, p_from date default null, p_to date default null, p_plate text default null,
  p_unit_id uuid default null, p_status text default 'all'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_q text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.assert_member(p_society);
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only admins can see the visitor log.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at, 'out_at', g.out_at,
             'unit_id', g.unit_id, 'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note,
             'in_by', ip.full_name, 'out_by', op.full_name,
             'minutes', case when g.out_at is null then null
                             else greatest(0, (extract(epoch from (g.out_at - g.in_at)) / 60)::int) end)
           order by g.in_at desc)
      from gate_visits g
      left join units u on u.id = g.unit_id
      left join profiles ip on ip.id = g.in_by
      left join profiles op on op.id = g.out_by
     where g.society_id = p_society
       and (p_from is null or (g.in_at at time zone 'Asia/Kolkata')::date >= p_from)
       and (p_to is null or (g.in_at at time zone 'Asia/Kolkata')::date <= p_to)
       and (v_q = '' or g.plate like '%' || v_q || '%')
       and (p_unit_id is null or g.unit_id = p_unit_id)
       and (coalesce(p_status, 'all') = 'all'
            or (p_status = 'inside' and g.out_at is null)
            or (p_status = 'left' and g.out_at is not null))), '[]'::jsonb);
end $$;

create or replace function public.set_visitor_log_retention(p_society uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_perm(p_society, 'manage_settings');
  if p_days is null or p_days < 3 or p_days > 60 then
    raise exception using errcode = 'P0001', message = 'Keep the visitor log between 3 and 60 days.';
  end if;
  update society_settings set visitor_log_retention_days = p_days, updated_at = now() where society_id = p_society;
end $$;

-- ---------------------------------------------------------------------------
-- Guard logins (created by the admin-users Edge Function)
-- ---------------------------------------------------------------------------
create or replace function public._create_guard_login(
  p_actor uuid, p_user uuid, p_society uuid, p_name text, p_phone text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._act_as(p_actor);
  if not public.user_has_perm(p_actor, p_society, 'manage_users') then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  if public.norm_phone(p_phone) is not null and exists (select 1 from profiles where phone = public.norm_phone(p_phone)) then
    raise exception using errcode = 'P0001', message = 'This mobile number is already used by another account.';
  end if;
  insert into profiles (id, full_name, phone, must_change_password)
  values (p_user, public.check_person_name(p_name), public.norm_phone(p_phone), true);
  insert into guards (society_id, user_id, created_by) values (p_society, p_user, p_actor) returning id into v_id;
  return v_id;
end $$;

create or replace function public._guard_for_admin_action(p_actor uuid, p_guard_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g record;
begin
  select * into g from guards where id = p_guard_id;
  if not found then raise exception using errcode = 'P0001', message = 'Gate login not found.'; end if;
  if not public.user_has_perm(p_actor, g.society_id, 'manage_users') then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  return jsonb_build_object('user_id', g.user_id, 'society_id', g.society_id);
end $$;

create or replace function public.guard_list(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_perm(p_society, 'manage_users');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'user_id', g.user_id, 'full_name', p.full_name,
                                        'phone', p.phone, 'status', g.status, 'created_at', g.created_at,
                                        'must_change_password', p.must_change_password)
                     order by g.created_at)
      from guards g join profiles p on p.id = g.user_id
     where g.society_id = p_society), '[]'::jsonb);
end $$;

create or replace function public.set_guard_status(p_guard_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare g record;
begin
  select * into g from guards where id = p_guard_id;
  if not found then raise exception using errcode = 'P0001', message = 'Gate login not found.'; end if;
  perform public.assert_perm(g.society_id, 'manage_users');
  if p_status not in ('active', 'disabled') then
    raise exception using errcode = 'P0001', message = 'Invalid status.';
  end if;
  update guards set status = p_status, disabled_at = case when p_status = 'disabled' then now() end
   where id = p_guard_id;
end $$;

-- ---------------------------------------------------------------------------
-- Daily jobs: purge old guest entries. Body copied from 20261009000006 with the
-- visitor-log purge added; nothing else changed.
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int; v_activated int;
        v_visits int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days, st.monthly_dues_enabled,
                  st.visitor_log_retention_days
             from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0; v_activated := 0; v_visits := 0;
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
      -- guest vehicle entries are kept only for a few days
      delete from gate_visits
       where society_id = s.id and in_at < now() - make_interval(days => s.visitor_log_retention_days);
      get diagnostics v_visits = row_count;
    exception when others then
      v_out := v_out || jsonb_build_object('society_id', s.id, 'error', sqlerrm);
      continue;
    end;
    v_out := v_out || jsonb_build_object('society_id', s.id, 'dues', v_dues, 'drafts', v_drafts, 'reminders', v_rem,
                                         'recurring_events', v_series, 'activated_events', v_activated,
                                         'locations_purged', v_purged, 'gate_visits_purged', v_visits);
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (nothing in this schema is callable by default)
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.norm_plate(text)', 'public.plate_text(text)', 'public.is_guard(uuid)', 'public.assert_guard(uuid)',
    'public.assert_gate_user(uuid)', 'public.gate_flats(uuid)', 'public.gate_lookup(uuid, text)',
    'public.gate_check_in(uuid, text, uuid, text)', 'public.gate_check_out(uuid)', 'public.gate_set_flat(uuid, uuid)',
    'public.gate_board(uuid)', 'public.add_vehicle(uuid, uuid, text, text, text, text)',
    'public.update_vehicle(uuid, text, text, text, text)', 'public.remove_vehicle(uuid)',
    'public.vehicle_directory(uuid)', 'public.my_vehicle_prompt(uuid)', 'public.dismiss_vehicle_prompt()',
    'public.visitor_log(uuid, date, date, text, uuid, text)', 'public.set_visitor_log_retention(uuid, int)',
    'public.guard_list(uuid)', 'public.set_guard_status(uuid, text)', 'public.my_context()']
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

grant execute on function public._vehicle_can_edit(uuid, uuid) to authenticated;
grant execute on function public._create_guard_login(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public._guard_for_admin_action(uuid, uuid) to service_role;
grant execute on function public.run_daily_jobs() to service_role;
