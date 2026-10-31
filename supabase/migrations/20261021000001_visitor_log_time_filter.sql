-- Add a same-day time-of-day window to the visitor log, so admins can see who
-- was inside between two clock times (e.g. 2 PM - 4 PM) within the selected
-- date range. The old 6-argument visitor_log() is dropped and replaced by an
-- 8-argument version so PostgREST never has to pick between two overloads.

drop function if exists public.visitor_log(uuid, date, date, text, uuid, text);

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
            or (p_status = 'left' and g.out_at is not null))
       and (
         (v_tf is null and v_tt is null)
         or (
           (g.in_at at time zone 'Asia/Kolkata')::time <= coalesce(v_tt, '23:59:59'::time)
           and (coalesce(g.out_at, now()) at time zone 'Asia/Kolkata')::time >= coalesce(v_tf, '00:00:00'::time)
         )
       )), '[]'::jsonb);
end $$;

revoke execute on function public.visitor_log(uuid, date, date, text, uuid, text, text, text) from public, anon;
grant execute on function public.visitor_log(uuid, date, date, text, uuid, text, text, text) to authenticated;
