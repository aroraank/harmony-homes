-- 2026-11-27: add resident phone + full_name to report RPCs.
--  * _month_report and event_report now include the active resident's
--    phone and full_name from profiles (via memberships) for each unit.
--  * The phone is exposed to the client; the UI decides visibility
--    based on the caller's role (admin/super_admin see it, residents don't).

-- -------------------------------------------------------------------------
-- _month_report: add phone to units JSON
-- -------------------------------------------------------------------------
create or replace function public._month_report(p_society uuid, p_period text, p_fund_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := public.period_start(p_period);
  v_end date := public.period_end(p_period);
  v_general uuid := public.general_fund_id(p_society);
  v_opening bigint; v_closing bigint;
  v_maint bigint; v_event bigint; v_other bigint; v_transfers bigint; v_spent bigint;
  v_expected bigint := 0; v_for_dues bigint := 0; v_from_adv bigint := 0;
  v_by_cat jsonb; v_payments jsonb; v_units jsonb; v_extra jsonb; v_expenses jsonb;
  v_include_dues boolean := p_fund_id is null or p_fund_id = v_general;
  v_net bigint;
begin
  if not public.is_valid_period(p_period) then
    raise exception using errcode = 'P0001', message = 'Invalid month.';
  end if;

  select
    coalesce(sum(case when entry_date < v_start then signed end), 0),
    coalesce(sum(case when entry_date <= v_end then signed end), 0),
    coalesce(sum(case when entry_date between v_start and v_end and category = 'maintenance' then signed end), 0),
    coalesce(sum(case when entry_date between v_start and v_end and category = 'event_contribution' then signed end), 0),
    coalesce(sum(case when entry_date between v_start and v_end and category in ('opening_balance', 'adjustment') then signed end), 0),
    coalesce(sum(case when entry_date between v_start and v_end and category = 'transfer' then signed end), 0),
    coalesce(sum(case when entry_date between v_start and v_end
                       and category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer') then -signed end), 0)
  into v_opening, v_closing, v_maint, v_event, v_other, v_transfers, v_spent
  from (select entry_date, category, case when direction = 'credit' then amount_paise else -amount_paise end as signed
          from ledger_entries where society_id = p_society and (p_fund_id is null or fund_id = p_fund_id)) t;

  select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'label', coalesce(c.label, initcap(x.category)), 'amount_paise', x.amt)
                            order by x.amt desc), '[]'::jsonb)
    into v_by_cat
    from (select category, sum(case when direction = 'debit' then amount_paise else -amount_paise end)::bigint as amt
            from ledger_entries
           where society_id = p_society and (p_fund_id is null or fund_id = p_fund_id)
             and entry_date between v_start and v_end
             and category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer')
           group by category having sum(case when direction = 'debit' then amount_paise else -amount_paise end) <> 0) x
    left join expense_categories c on c.society_id = p_society and c.code = x.category;

  select coalesce(jsonb_agg(jsonb_build_object('entry_id', e.id, 'date', e.entry_date, 'payee', e.payee, 'category', e.category,
                                               'amount_paise', e.amount_paise, 'mode', e.payment_mode, 'fund', f.name)
                            order by e.entry_date, e.created_at), '[]'::jsonb)
    into v_expenses
    from ledger_entries e join funds f on f.id = e.fund_id
   where e.society_id = p_society and (p_fund_id is null or e.fund_id = p_fund_id)
     and e.entry_date between v_start and v_end and e.direction = 'debit' and e.reverses_entry_id is null
     and not public.is_entry_reversed(e.id)
     and e.category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer');

  select coalesce(jsonb_agg(jsonb_build_object('entry_id', e.id, 'unit_id', e.unit_id, 'unit_code', u.code, 'amount_paise', e.amount_paise,
                                               'date', e.entry_date, 'mode', e.payment_mode, 'receipt_no', e.receipt_no,
                                               'fund', f.name, 'category', e.category)
                            order by e.entry_date, u.sort_order), '[]'::jsonb)
    into v_payments
    from ledger_entries e join units u on u.id = e.unit_id join funds f on f.id = e.fund_id
   where e.society_id = p_society and (p_fund_id is null or e.fund_id = p_fund_id)
     and e.entry_date between v_start and v_end and e.direction = 'credit'
     and e.category in ('maintenance', 'event_contribution') and e.reverses_entry_id is null
     and not public.is_entry_reversed(e.id);

  if v_include_dues then
    select coalesce(sum(d.amount_paise), 0) into v_expected
      from dues d where d.society_id = p_society and d.period = p_period and d.due_type = 'monthly' and not d.waived;
    select coalesce(sum(a.amount_paise), 0),
           coalesce(sum(case when e.entry_date < v_start then a.amount_paise end), 0)
      into v_for_dues, v_from_adv
      from due_allocations a join dues d on d.id = a.due_id join ledger_entries e on e.id = a.ledger_entry_id
     where d.society_id = p_society and d.period = p_period and d.due_type = 'monthly' and not d.waived
       and not public.is_entry_reversed(e.id);

    select coalesce(jsonb_agg(jsonb_build_object(
              'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
              'phone', (select p.phone from memberships m join profiles p on p.id = m.user_id
                         where m.unit_id = u.id and m.society_id = p_society and m.status = 'active'
                           and m.role = 'resident' limit 1))
                              || public.unit_period_status(u.id, p_period) order by u.sort_order, u.code), '[]'::jsonb)
      into v_units
      from units u where u.society_id = p_society and (u.is_billable or exists (select 1 from dues d where d.unit_id = u.id and d.period = p_period));

    -- part of this month's payments that went beyond dues up to this month (advance / future months)
    select coalesce(jsonb_agg(jsonb_build_object('unit_id', x.unit_id, 'unit_code', x.code, 'extra_paise', x.extra) order by x.extra desc), '[]'::jsonb)
      into v_extra
      from (
        select e.unit_id, u.code,
               sum(e.amount_paise)::bigint - coalesce((select sum(a.amount_paise) from due_allocations a
                 join dues d2 on d2.id = a.due_id where a.ledger_entry_id = any(array_agg(e.id))
                   and d2.period <= p_period and not d2.waived), 0)::bigint as extra
          from ledger_entries e join units u on u.id = e.unit_id
         where e.society_id = p_society and e.entry_date between v_start and v_end
           and e.direction = 'credit' and e.category = 'maintenance'
           and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)
         group by e.unit_id, u.code
        having sum(e.amount_paise)::bigint - coalesce((select sum(a.amount_paise) from due_allocations a
                 join dues d2 on d2.id = a.due_id where a.ledger_entry_id = any(array_agg(e.id))
                   and d2.period <= p_period and not d2.waived), 0)::bigint > 0
      ) x;
  else
    v_units := '[]'::jsonb;
    v_extra := '[]'::jsonb;
  end if;

  v_net := v_closing - v_opening;

  return jsonb_build_object(
    'period', p_period, 'label', public.period_label(p_period), 'fund_id', p_fund_id,
    'is_closed', v_end < public.ist_today(),
    'opening_paise', v_opening, 'closing_paise', v_closing,
    'maintenance_collected_paise', v_maint, 'event_collected_paise', v_event,
    'other_income_paise', v_other, 'transfers_net_paise', v_transfers, 'spent_paise', v_spent,
    'net_paise', v_net,
    'shortfall_paise', greatest(-v_net, 0), 'surplus_paise', greatest(v_net, 0),
    'expected_paise', v_expected, 'collected_for_dues_paise', v_for_dues,
    'collected_from_advances_paise', v_from_adv,
    'pending_paise', greatest(v_expected - v_for_dues, 0),
    'spent_by_category', v_by_cat,
    'expenses', v_expenses,
    'payments', v_payments,
    'units', v_units,
    'extra_payers', v_extra
  );
end $$;

-- -------------------------------------------------------------------------
-- event_report: add phone to units JSON
-- -------------------------------------------------------------------------
create or replace function public.event_report(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ev record; v_collected bigint := 0; v_spent bigint := 0; v_transfers bigint := 0; v_pending bigint := 0; v_balance bigint := 0;
begin
  select * into ev from events where id = p_event_id;
  if not found then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_member(ev.society_id);
  if ev.fund_id is not null then
    select coalesce(sum(case when category = 'event_contribution' then (case when direction = 'credit' then amount_paise else -amount_paise end) end), 0),
           coalesce(sum(case when category not in ('event_contribution', 'transfer', 'opening_balance', 'adjustment')
                             then (case when direction = 'debit' then amount_paise else -amount_paise end) end), 0),
           coalesce(sum(case when category = 'transfer' then (case when direction = 'credit' then amount_paise else -amount_paise end) end), 0)
      into v_collected, v_spent, v_transfers
      from ledger_entries where fund_id = ev.fund_id;
    v_balance := public.fund_balance_paise(ev.fund_id);
    select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0) into v_pending
      from dues d where d.event_id = ev.id and not d.waived;
  end if;
  return jsonb_build_object(
    'event', to_jsonb(ev) || jsonb_build_object('scope_unit_type_names',
              (select coalesce(jsonb_agg(t.name), '[]'::jsonb) from unit_types t where t.id = any(ev.scope_unit_type_ids))),
    'target_paise', ev.total_cost_paise,
    'expected_collection_paise', ev.per_unit_share_paise * ev.expected_count,
    'rounding_buffer_paise', ev.per_unit_share_paise * ev.expected_count - ev.total_cost_paise,
    'collected_paise', v_collected, 'spent_paise', v_spent, 'transfers_paise', v_transfers,
    'balance_paise', v_balance, 'remaining_to_collect_paise', v_pending,
    'surplus_paise', greatest(v_collected - v_spent, 0), 'shortfall_paise', greatest(v_spent - v_collected, 0),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
                'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
                'phone', (select p.phone from memberships mm join profiles p on p.id = mm.user_id
                           where mm.unit_id = u.id and mm.society_id = ev.society_id and mm.status = 'active'
                             and mm.role = 'resident' limit 1),
                'expected', eu.expected,
                'exclusion_reason', eu.exclusion_reason, 'due_id', d.id,
                'due_paise', coalesce(d.amount_paise, 0), 'paid_paise', coalesce(public.due_paid_paise(d.id), 0),
                'waived', coalesce(d.waived, false),
                'extra_paise', case when ev.fund_id is null then 0 else public.unit_advance_paise(u.id, ev.fund_id) end,
                'status', case when not eu.expected then 'excluded'
                               when d.id is null then 'draft'
                               when d.waived then 'waived'
                               when public.due_paid_paise(d.id) >= d.amount_paise then 'paid'
                               when public.due_paid_paise(d.id) > 0 then 'partial'
                               else 'pending' end) order by u.sort_order, u.code)
              from event_units eu join units u on u.id = eu.unit_id
              left join dues d on d.event_id = ev.id and d.unit_id = u.id
             where eu.event_id = ev.id), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('entry_id', l.id, 'date', l.entry_date, 'direction', l.direction,
                'amount_paise', l.amount_paise, 'category', l.category, 'unit_code', u.code, 'payee', l.payee, 'note', l.note,
                'is_reversed', public.is_entry_reversed(l.id), 'is_reversal', l.reverses_entry_id is not null)
                order by l.entry_date desc, l.created_at desc)
              from ledger_entries l left join units u on u.id = l.unit_id where l.fund_id = ev.fund_id), '[]'::jsonb)
  );
end $$;
