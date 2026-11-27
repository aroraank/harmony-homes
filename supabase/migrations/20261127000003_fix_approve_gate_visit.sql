-- Fix: 20261127000001 rewrote approve_gate_visit to call
-- public.assert_unit_resident(...) and public.assert_society_admin(...),
-- neither of which exists, breaking "Let it in" with
-- "function public.assert_resident does not exist".
-- Restore the real ownership/role checks (assert_member + is_admin/my_unit_ids
-- for residents, assert_gate_user + confirmation note for guard override),
-- keep the bilingual notification added in 20261127000001.

create or replace function public.approve_gate_visit(
  p_visit_id uuid, p_decision text, p_via text default 'resident', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_decision not in ('approve', 'deny') then
    raise exception using errcode = 'P0001', message = 'Decision must be approve or deny.';
  end if;
  if p_via not in ('resident', 'guard_override') then
    raise exception using errcode = 'P0001', message = 'Invalid approval method.';
  end if;
  select * into v from gate_visits where id = p_visit_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Visit not found.'; end if;
  if v.approval_status not in ('pending', 'auto') then
    raise exception using errcode = 'P0001', message = 'Already decided.';
  end if;
  if v.out_at is not null then
    raise exception using errcode = 'P0001', message = 'This vehicle has already left.';
  end if;

  if p_via = 'resident' then
    perform public.assert_member(v.society_id);
    if not (public.is_admin(v.society_id) or v.unit_id in (select public.my_unit_ids(v.society_id))) then
      raise exception using errcode = '42501', message = 'This is not your flat''s gate entry.';
    end if;
  else
    perform public.assert_gate_user(v.society_id);
    if p_decision = 'approve' and char_length(coalesce(public.clean_text(p_note), '')) < 3 then
      raise exception using errcode = 'P0001', message = 'Say how you confirmed it, e.g. spoke on the phone.';
    end if;
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

revoke execute on function public.approve_gate_visit(uuid, text, text, text) from public, anon;
grant execute on function public.approve_gate_visit(uuid, text, text, text) to authenticated;
