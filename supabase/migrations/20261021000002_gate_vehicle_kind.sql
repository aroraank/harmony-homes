-- Let the guard tag a guest vehicle's kind (car/bike/scooter/truck/other) with one tap
-- instead of typing, and surface it everywhere the gate log is shown.

alter table public.gate_visits
  add column if not exists kind text check (kind in ('car', 'bike', 'scooter', 'truck', 'other'));

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
                            'unit_name', u.display_name, 'plate_text', g.plate_text, 'note', g.note, 'kind', g.kind)
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

drop function if exists public.gate_check_in(uuid, text, uuid, text);
create or replace function public.gate_check_in(
  p_society uuid, p_plate text, p_unit_id uuid, p_note text default null, p_kind text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_plate text := public.norm_plate(p_plate); v_id uuid; v_code text; v_open timestamptz;
begin
  perform public.assert_gate_user(p_society);
  if p_kind is not null and p_kind not in ('car', 'bike', 'scooter', 'truck', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose a vehicle type.';
  end if;
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
  insert into gate_visits (society_id, plate, plate_text, unit_id, in_by, note, kind)
  values (p_society, v_plate, coalesce(public.plate_text(p_plate), v_plate), p_unit_id, auth.uid(),
          left(public.clean_text(p_note), 120), p_kind)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'plate', v_plate);
end $$;

create or replace function public.gate_board(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open jsonb; v_recent jsonb; v_in_today int;
begin
  perform public.assert_gate_user(p_society);
  select coalesce(jsonb_agg(x order by x->>'in_at' desc), '[]'::jsonb) into v_open from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note, 'kind', g.kind) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is null) s;
  select coalesce(jsonb_agg(x order by x->>'out_at' desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at, 'out_at', g.out_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'kind', g.kind) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is not null and g.out_at > now() - interval '12 hours'
     order by g.out_at desc limit 15) s;
  select count(*) into v_in_today from gate_visits
   where society_id = p_society and (in_at at time zone 'Asia/Kolkata')::date = public.ist_today();
  return jsonb_build_object('inside', v_open, 'recent_out', v_recent, 'in_today', v_in_today,
                            'society_name', (select name from societies where id = p_society));
end $$;

create or replace function public.visitor_log(
  p_society uuid, p_from date default null, p_to date default null, p_plate text default null,
  p_unit_id uuid default null, p_status text default 'all', p_time_from text default null, p_time_to text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_q text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_tf time;
  v_tt time;
begin
  perform public.assert_member(p_society);
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only admins can see the visitor log.';
  end if;

  if p_time_from is not null then
    if p_time_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = 'P0001', message = 'Enter the start time as HH:MM.';
    end if;
    v_tf := p_time_from::time;
  end if;
  if p_time_to is not null then
    if p_time_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = 'P0001', message = 'Enter the end time as HH:MM.';
    end if;
    v_tt := p_time_to::time;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at, 'out_at', g.out_at,
             'unit_id', g.unit_id, 'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note, 'kind', g.kind,
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
            or (p_status = 'left' and g.out_at is not null))
       and (
         (v_tf is null and v_tt is null)
         or (
           (g.in_at at time zone 'Asia/Kolkata')::time <= coalesce(v_tt, '23:59:59'::time)
           and (coalesce(g.out_at, now()) at time zone 'Asia/Kolkata')::time >= coalesce(v_tf, '00:00:00'::time)
         )
       )), '[]'::jsonb);
end $$;

revoke execute on function public.gate_check_in(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.gate_check_in(uuid, text, uuid, text, text) to authenticated;
