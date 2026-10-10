-- Pay screen: only show a "purpose" (Maintenance or an event/fund like 3BHK motor repair) in the
-- pay dropdown when the member's own flat actually has something pending for it. Previously
-- "Maintenance" was always listed even when fully paid, forcing members with nothing due to see
-- a payment form anyway; the frontend now shows a congratulatory "all clear" screen instead when
-- this array comes back empty.
create or replace function public.my_pay_info(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_unit uuid; s record; v_general uuid := public.general_fund_id(p_society);
begin
  perform public.assert_member(p_society);
  select unit_id into v_unit from memberships where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null limit 1;
  select * into s from society_settings where society_id = p_society;
  return jsonb_build_object(
    'unit_id', v_unit, 'unit_code', (select code from units where id = v_unit),
    'upi_id', s.upi_id, 'upi_payee_name', s.upi_payee_name, 'bank_account_name', s.bank_account_name, 'upi_qr_path', s.upi_qr_path,
    'monthly_due_paise', s.monthly_due_paise,
    'purposes', coalesce((
      select jsonb_agg(p order by (p ->> 'kind') desc, p ->> 'label') from (
        select jsonb_build_object('fund_id', v_general, 'kind', 'general', 'label', 'Maintenance',
          'pending_paise', gp.pending_paise,
          'oldest_period', (select d.period from dues d where d.unit_id = v_unit and d.fund_id = v_general and not d.waived
                              and d.amount_paise > public.due_paid_paise(d.id) order by d.due_date limit 1)) as p
        from (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0) as pending_paise
                from dues d where d.unit_id = v_unit and d.fund_id = v_general and not d.waived) gp
        where v_unit is not null and gp.pending_paise > 0
        union all
        select jsonb_build_object('fund_id', e.fund_id, 'kind', 'event', 'label', e.title, 'event_id', e.id,
          'pending_paise', greatest(d.amount_paise - public.due_paid_paise(d.id), 0))
          from dues d join events e on e.id = d.event_id
         where d.unit_id = v_unit and not d.waived and d.amount_paise > public.due_paid_paise(d.id)
      ) t), '[]'::jsonb)
  );
end $fn$;
