-- Make vehicle gate notifications bilingual (English + Hindi)
-- so uneducated guards and residents can understand them.

-- 1. Update gate_check_in to send bilingual push notification
create or replace function public.gate_check_in(
  p_society uuid, p_plate text, p_unit_id uuid, p_note text default null, p_kind text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plate text := public.norm_plate(p_plate);
  v_id uuid; v_code text; v_open timestamptz; v_status text := 'auto';
  v_display text;
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
  if p_unit_id is not null then v_status := 'pending'; end if;
  v_display := coalesce(public.plate_text(p_plate), v_plate);
  insert into gate_visits (society_id, plate, plate_text, unit_id, in_by, note, kind, approval_status)
  values (p_society, v_plate, v_display, p_unit_id, auth.uid(),
          left(public.clean_text(p_note), 120), p_kind, v_status)
  returning id into v_id;
  if v_status = 'pending' then
    perform public._notify(p_society, public._unit_user_ids(p_unit_id), 'vehicle_approval', v_id,
      format('गाड़ी %s गेट पर है / Vehicle %s at gate', v_display, v_display),
      'गार्ड आपकी मंज़ूरी के बिना अंदर नहीं आने देगा। टैप करें। / Guard will not let it in without your approval. Tap to decide.',
      '/vehicles/approve/' || v_id);
  end if;
  return jsonb_build_object('id', v_id, 'plate', v_plate, 'approval_status', v_status);
end $$;

-- 2. Update approve_gate_visit to send bilingual guard-override notification
create or replace function public.approve_gate_visit(
  p_visit_id uuid, p_decision text, p_via text default 'resident', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_decision not in ('approve', 'deny') then
    raise exception using errcode = 'P0001', message = 'Decision must be approve or deny.';
  end if;
  select * into v from gate_visits where id = p_visit_id;
  if v is null then raise exception using errcode = 'P0001', message = 'Visit not found.'; end if;
  if v.approval_status not in ('pending', 'auto') then
    raise exception using errcode = 'P0001', message = 'Already decided.';
  end if;
  if p_via = 'resident' then
    perform public.assert_unit_resident(v.unit_id);
  elseif p_via = 'guard_override' then
    perform public.assert_gate_user(v.society_id);
  else
    perform public.assert_society_admin(v.society_id);
  end if;
  update gate_visits
     set approval_status = case when p_decision = 'approve' then 'approved' else 'denied' end,
         approved_by = auth.uid(), approved_at = now(), approved_via = p_via,
         approval_note = left(public.clean_text(p_note), 200),
         out_at = case when p_decision = 'deny' then now() else out_at end,
         out_by = case when p_decision = 'deny' then auth.uid() else out_by end
   where id = p_visit_id;
  if p_via = 'guard_override' and v.unit_id is not null then
    perform public._notify(v.society_id, public._unit_user_ids(v.unit_id), 'vehicle_approval_resolved', v.id,
      format('%s — %s', v.plate_text,
        case when p_decision = 'approve'
          then 'गार्ड ने अंदर आने दिया / let in by guard'
          else 'गार्ड ने रोक दिया / kept out by guard'
        end),
      'गार्ड ने बताया कि उन्होंने आपसे फ़ोन पर बात कर ली थी। / The guard said they had already spoken with you on the phone.',
      '/vehicles');
  end if;
  return jsonb_build_object('id', v.id, 'approval_status', case when p_decision = 'approve' then 'approved' else 'denied' end);
end $$;
