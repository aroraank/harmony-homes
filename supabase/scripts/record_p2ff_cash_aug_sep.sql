-- P2-FF (Plot 2 First Floor) paid its pending Aug + Sep 2026 security guard shares: ₹800 x 2, cash, handed to Lakhwir ji.
-- Safe to run once; re-running does nothing (idempotency keys).
do $$
declare
  v_society uuid; v_unit uuid; v_event uuid; v_fund uuid; p text; v_res jsonb; v_n int := 0;
begin
  select id into v_society from societies where slug = 'plot-colony';
  select id into v_unit from units where society_id = v_society and code = 'P2-FF';
  if v_unit is null then raise exception 'Flat P2-FF not found'; end if;
  foreach p in array array['2026-08', '2026-09'] loop
    select e.id, e.fund_id into v_event, v_fund from events e
     where e.society_id = v_society and e.series_period = p and e.title like 'Security guard%' order by e.created_at desc limit 1;
    if v_event is null then raise exception 'Security guard event for % not found', p; end if;
    if not exists (select 1 from dues d where d.event_id = v_event and d.unit_id = v_unit and not d.waived
                    and d.amount_paise > public.due_paid_paise(d.id)) then
      raise notice '% already paid or not due for P2-FF - skipped', p; continue;
    end if;
    v_res := public._post_unit_payment(v_society, v_unit, v_fund, 80000, public.ist_today(), 'cash', null,
      'Cash paid to Lakhwir ji (' || public._period_label(p) || ')', null, 'cash-P2-FF-' || p, null, true, null);
    v_n := v_n + 1;
  end loop;
  raise notice 'Recorded % payment(s) for P2-FF', v_n;
end $$;
