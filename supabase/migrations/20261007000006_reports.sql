-- Harmony Homes — reports and read models. Balances are always computed from the ledger.

-- ---------------------------------------------------------------------------
-- Read views (security_invoker => the caller's RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.v_ledger with (security_invoker = true) as
select
  e.id, e.society_id, e.fund_id, f.name as fund_name, f.kind as fund_kind, e.entry_date, e.direction, e.amount_paise,
  e.category, e.unit_id, u.code as unit_code, e.payee, e.payment_mode, e.reference_no, e.note, e.attachment_path,
  e.created_by, p.full_name as created_by_name, e.created_at, e.reverses_entry_id, e.transfer_group, e.receipt_no,
  e.receipt_token, e.claim_id, e.backdate_reason,
  public.is_entry_reversed(e.id) as is_reversed,
  (select r.note from public.ledger_entries r where r.reverses_entry_id = e.id limit 1) as reversal_note,
  case when e.direction = 'credit' then e.amount_paise else -e.amount_paise end as signed_paise
from public.ledger_entries e
join public.funds f on f.id = e.fund_id
left join public.units u on u.id = e.unit_id
left join public.profiles p on p.id = e.created_by;

create or replace view public.v_dues with (security_invoker = true) as
select
  d.id, d.society_id, d.unit_id, u.code as unit_code, u.display_name as unit_name, d.fund_id, d.due_type, d.period,
  d.event_id, ev.title as event_title, d.amount_paise, d.due_date, d.waived, d.waived_reason, d.created_at,
  case when d.due_type = 'monthly' then public.period_label(d.period) else ev.title end as label,
  public.due_paid_paise(d.id) as paid_paise,
  case when d.waived then 0 else greatest(d.amount_paise - public.due_paid_paise(d.id), 0) end as pending_paise
from public.dues d
join public.units u on u.id = d.unit_id
left join public.events ev on ev.id = d.event_id;

grant select on public.v_ledger, public.v_dues to authenticated;
revoke all on public.v_ledger, public.v_dues from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.society_balance_paise(p_society uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when direction = 'credit' then amount_paise else -amount_paise end), 0)::bigint
    from ledger_entries where society_id = p_society
$$;

-- Status of one unit for one month: paid / partial / pending / advance / waived / none
create or replace function public.unit_period_status(p_unit uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d record; v_paid bigint; v_adv bigint; v_status text;
begin
  select * into d from dues where unit_id = p_unit and period = p_period and due_type = 'monthly';
  v_adv := public.unit_advance_paise(p_unit, public.general_fund_id((select society_id from units where id = p_unit)));
  if not found then
    return jsonb_build_object('status', case when v_adv > 0 then 'advance' else 'none' end, 'due_paise', 0, 'paid_paise', 0,
                              'pending_paise', 0, 'advance_paise', v_adv);
  end if;
  v_paid := public.due_paid_paise(d.id);
  v_status := case
    when d.waived then 'waived'
    when v_paid >= d.amount_paise and v_adv > 0 then 'advance'
    when v_paid >= d.amount_paise then 'paid'
    when v_paid > 0 then 'partial'
    else 'pending' end;
  return jsonb_build_object('status', v_status, 'due_id', d.id, 'due_paise', d.amount_paise, 'paid_paise', v_paid,
    'pending_paise', case when d.waived then 0 else greatest(d.amount_paise - v_paid, 0) end,
    'advance_paise', v_adv, 'due_date', d.due_date, 'overdue', not d.waived and v_paid < d.amount_paise and d.due_date < public.ist_today());
end $$;

-- ---------------------------------------------------------------------------
-- Month report (also used as the month-closing snapshot)
-- ---------------------------------------------------------------------------
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

    select coalesce(jsonb_agg(jsonb_build_object('unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name)
                              || public.unit_period_status(u.id, p_period) order by u.sort_order, u.code), '[]'::jsonb)
      into v_units
      from units u where u.society_id = p_society and (u.is_billable or exists (select 1 from dues d where d.unit_id = u.id and d.period = p_period));

    -- part of this month's payments that went beyond dues up to this month (advance / future months)
    select coalesce(jsonb_agg(jsonb_build_object('unit_id', x.unit_id, 'unit_code', x.code, 'extra_paise', x.extra) order by x.extra desc), '[]'::jsonb)
      into v_extra
      from (
        select e.unit_id, u.code,
               sum(e.amount_paise - coalesce((select sum(a.amount_paise) from due_allocations a join dues d on d.id = a.due_id
                                               where a.ledger_entry_id = e.id and d.due_date <= v_end), 0))::bigint as extra
          from ledger_entries e join units u on u.id = e.unit_id
         where e.society_id = p_society and e.fund_id = v_general and e.category = 'maintenance' and e.direction = 'credit'
           and e.entry_date between v_start and v_end and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)
         group by e.unit_id, u.code
      ) x where x.extra > 0;
  end if;

  v_net := v_closing - v_opening;
  return jsonb_build_object(
    'period', p_period, 'label', public.period_label(p_period), 'fund_id', p_fund_id,
    'is_closed', public.is_month_closed(p_society, p_period),
    'opening_paise', v_opening, 'closing_paise', v_closing,
    'maintenance_collected_paise', v_maint, 'event_collected_paise', v_event,
    'other_income_paise', v_other, 'transfers_net_paise', v_transfers,
    'spent_paise', v_spent, 'net_paise', v_net,
    'shortfall_paise', case when v_net < 0 then -v_net else 0 end,
    'surplus_paise', case when v_net > 0 then v_net else 0 end,
    'expected_paise', v_expected, 'collected_for_dues_paise', v_for_dues, 'collected_from_advances_paise', v_from_adv,
    'pending_paise', greatest(v_expected - v_for_dues, 0),
    'spent_by_category', v_by_cat, 'expenses', v_expenses, 'payments', v_payments,
    'units', coalesce(v_units, '[]'::jsonb), 'extra_payers', coalesce(v_extra, '[]'::jsonb)
  );
end $$;

create or replace function public.month_report(p_society uuid, p_period text, p_fund_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if p_fund_id is not null and not exists (select 1 from funds where id = p_fund_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  return public._month_report(p_society, p_period, p_fund_id);
end $$;

-- ---------------------------------------------------------------------------
-- Month closing / reopen
-- ---------------------------------------------------------------------------
create or replace function public.close_month(p_society uuid, p_period text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_perm(p_society, 'close_month');
  if not public.is_valid_period(p_period) then raise exception using errcode = 'P0001', message = 'Invalid month.'; end if;
  if p_period >= public.period_of(public.ist_today()) then
    raise exception using errcode = 'P0001', message = 'Only past months can be closed.';
  end if;
  if public.is_month_closed(p_society, p_period) then
    raise exception using errcode = 'P0001', message = 'Already closed.';
  end if;
  insert into month_closings (society_id, period, closed_by, snapshot)
  values (p_society, p_period, auth.uid(), public._month_report(p_society, p_period, null));
end $$;

create or replace function public.reopen_month(p_society uuid, p_period text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_reason text := public.clean_text(p_reason);
begin
  perform public.assert_perm(p_society, 'reopen_month');
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Give a reason (at least 5 characters).';
  end if;
  update month_closings set reopened_at = now(), reopened_by = auth.uid(), reopen_reason = left(v_reason, 300)
   where society_id = p_society and period = p_period and reopened_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'That month is not closed.'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------------
create or replace function public.dashboard(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_period text := public.period_of(public.ist_today());
  v_general uuid := public.general_fund_id(p_society);
  v_my_unit uuid;
  v_counts jsonb;
  v_expected bigint; v_collected bigint;
  v_admin jsonb := null;
  v_mine jsonb := null;
begin
  v_role := public.assert_member(p_society);
  select unit_id into v_my_unit from memberships where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null limit 1;

  select coalesce(sum(d.amount_paise), 0), coalesce(sum(least(public.due_paid_paise(d.id), d.amount_paise)), 0)
    into v_expected, v_collected
    from dues d where d.society_id = p_society and d.period = v_period and d.due_type = 'monthly' and not d.waived;

  select jsonb_object_agg(st, n) into v_counts from (
    select (public.unit_period_status(u.id, v_period) ->> 'status') as st, count(*) as n
      from units u where u.society_id = p_society and u.is_billable group by 1) t;

  if v_role in ('admin', 'super_admin') then
    v_admin := jsonb_build_object(
      'pending_claims', (select count(*) from payment_claims where society_id = p_society and status = 'pending'),
      'pending_drafts', (select count(*) from expense_drafts where society_id = p_society and status = 'pending'),
      'open_concerns', (select count(*) from concerns where society_id = p_society and status in ('open', 'in_progress')),
      'open_alerts', (select count(*) from alerts where society_id = p_society and resolved_at is null),
      'pending_registrations', (select count(*) from memberships where society_id = p_society and status = 'pending'),
      'suggested_contacts', (select count(*) from contacts where society_id = p_society and status = 'suggested'),
      'dues_generated', exists (select 1 from dues where society_id = p_society and period = v_period and due_type = 'monthly')
    );
  end if;

  if v_my_unit is not null then
    v_mine := jsonb_build_object(
      'unit_id', v_my_unit,
      'unit_code', (select code from units where id = v_my_unit),
      'pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.unit_id = v_my_unit and not d.waived),
      'maintenance_pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.unit_id = v_my_unit and not d.waived and d.fund_id = v_general),
      'advance_paise', public.unit_advance_paise(v_my_unit, v_general),
      'this_month', public.unit_period_status(v_my_unit, v_period),
      'pending_claims', (select count(*) from payment_claims where unit_id = v_my_unit and status = 'pending')
    );
  end if;

  return jsonb_build_object(
    'period', v_period, 'role', v_role,
    'balance_paise', public.society_balance_paise(p_society),
    'funds', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'event_id', f.event_id,
                                                           'balance_paise', public.fund_balance_paise(f.id))
                                        order by f.kind desc, f.created_at)
                         from funds f where f.society_id = p_society
                          and (f.kind = 'general' or public.fund_balance_paise(f.id) <> 0
                               or exists (select 1 from events e where e.fund_id = f.id and e.status = 'open'))), '[]'::jsonb),
    'month', jsonb_build_object('expected_paise', v_expected, 'collected_paise', v_collected,
                                'spent_paise', (select coalesce(sum(case when direction = 'debit' then amount_paise else -amount_paise end), 0)
                                                  from ledger_entries where society_id = p_society
                                                   and entry_date between public.period_start(v_period) and public.period_end(v_period)
                                                   and category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer')),
                                'status_counts', coalesce(v_counts, '{}'::jsonb)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'target_paise', e.total_cost_paise,
                                         'per_unit_share_paise', e.per_unit_share_paise, 'due_date', e.due_date,
                                         'collected_paise', (select coalesce(sum(case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end), 0)
                                                               from ledger_entries l where l.fund_id = e.fund_id and l.category = 'event_contribution'))
                                         order by e.due_date)
                          from events e where e.society_id = p_society and e.status = 'open'), '[]'::jsonb),
    'fixed_expenses', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'amount_paise', t.amount_paise, 'day_of_month', t.day_of_month)
                                                 order by t.day_of_month)
                                  from expense_templates t where t.society_id = p_society and t.is_active), '[]'::jsonb),
    'unacked_notices', (select count(*) from notice_receipts r join notices n on n.id = r.notice_id
                         where r.user_id = auth.uid() and r.society_id = p_society and r.acknowledged_at is null
                           and n.archived_at is null and n.require_ack),
    'unread_notifications', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'admin', v_admin,
    'mine', v_mine
  );
end $$;

-- ---------------------------------------------------------------------------
-- Unit statement
-- ---------------------------------------------------------------------------
create or replace function public.unit_statement(p_unit_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u record; v_general uuid;
begin
  select un.*, ut.name as type_name into u from units un join unit_types ut on ut.id = un.unit_type_id where un.id = p_unit_id;
  if not found then raise exception using errcode = 'P0001', message = 'Flat not found.'; end if;
  perform public.assert_member(u.society_id);
  v_general := public.general_fund_id(u.society_id);
  return jsonb_build_object(
    'unit', jsonb_build_object('id', u.id, 'code', u.code, 'display_name', u.display_name, 'type', u.type_name, 'status', u.status),
    'dues', coalesce((select jsonb_agg(jsonb_build_object(
                'id', d.id, 'label', public.due_label(d.id), 'due_type', d.due_type, 'period', d.period, 'event_id', d.event_id,
                'due_date', d.due_date, 'amount_paise', d.amount_paise, 'paid_paise', public.due_paid_paise(d.id),
                'pending_paise', case when d.waived then 0 else greatest(d.amount_paise - public.due_paid_paise(d.id), 0) end,
                'waived', d.waived, 'waived_reason', d.waived_reason) order by d.due_date desc, d.created_at desc)
              from dues d where d.unit_id = u.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
                'entry_id', e.id, 'date', e.entry_date, 'amount_paise', e.amount_paise, 'fund', f.name, 'fund_kind', f.kind,
                'mode', e.payment_mode, 'reference_no', e.reference_no, 'receipt_no', e.receipt_no,
                'is_reversed', public.is_entry_reversed(e.id), 'note', e.note,
                'allocations', (select coalesce(jsonb_agg(jsonb_build_object('label', public.due_label(a.due_id), 'amount_paise', a.amount_paise)), '[]'::jsonb)
                                  from due_allocations a where a.ledger_entry_id = e.id))
                order by e.entry_date desc, e.created_at desc)
              from ledger_entries e join funds f on f.id = e.fund_id
             where e.unit_id = u.id and e.direction = 'credit' and e.reverses_entry_id is null
               and e.category in ('maintenance', 'event_contribution')), '[]'::jsonb),
    'totals', jsonb_build_object(
      'pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0) from dues d where d.unit_id = u.id and not d.waived),
      'overdue_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0) from dues d
                         where d.unit_id = u.id and not d.waived and d.due_date < public.ist_today()),
      'paid_paise', (select coalesce(sum(e.amount_paise), 0) from ledger_entries e where e.unit_id = u.id and e.direction = 'credit'
                       and e.reverses_entry_id is null and e.category in ('maintenance', 'event_contribution') and not public.is_entry_reversed(e.id)),
      'advance_paise', public.unit_advance_paise(u.id, v_general),
      'event_advance_paise', (select coalesce(sum(public.unit_advance_paise(u.id, f.id)), 0) from funds f where f.society_id = u.society_id and f.kind = 'event')
    )
  );
end $$;

-- ---------------------------------------------------------------------------
-- Defaulters
-- ---------------------------------------------------------------------------
create or replace function public.defaulters(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'pending_paise')::bigint desc, x ->> 'unit_code') from (
      select jsonb_build_object(
        'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
        'pending_paise', sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)),
        'months_overdue', count(*) filter (where d.due_type = 'monthly' and d.amount_paise > public.due_paid_paise(d.id)),
        'events_overdue', count(*) filter (where d.due_type = 'event' and d.amount_paise > public.due_paid_paise(d.id)),
        'oldest_due_date', min(d.due_date) filter (where d.amount_paise > public.due_paid_paise(d.id)),
        'periods', (select jsonb_agg(public.due_label(d2.id) order by d2.due_date) from dues d2
                     where d2.unit_id = u.id and not d2.waived and d2.due_date < public.ist_today()
                       and d2.amount_paise > public.due_paid_paise(d2.id))
      ) as x
      from units u join dues d on d.unit_id = u.id
     where u.society_id = p_society and not d.waived and d.due_date < public.ist_today()
     group by u.id, u.code, u.display_name
    having sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)) > 0
    ) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Event report
-- ---------------------------------------------------------------------------
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
                'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name, 'expected', eu.expected,
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

-- ---------------------------------------------------------------------------
-- 12-month trend
-- ---------------------------------------------------------------------------
create or replace function public.trend_months(p_society uuid, p_months int default 12) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_n int := least(greatest(coalesce(p_months, 12), 1), 36);
begin
  perform public.assert_member(p_society);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'period', m.period, 'label', public.period_label(m.period),
      'collected_paise', coalesce((select sum(case when direction = 'credit' then amount_paise else -amount_paise end)
                                     from ledger_entries where society_id = p_society and category in ('maintenance', 'event_contribution')
                                      and entry_date between public.period_start(m.period) and public.period_end(m.period)), 0),
      'spent_paise', coalesce((select sum(case when direction = 'debit' then amount_paise else -amount_paise end)
                                 from ledger_entries where society_id = p_society
                                  and category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer')
                                  and entry_date between public.period_start(m.period) and public.period_end(m.period)), 0),
      'closing_paise', coalesce((select sum(case when direction = 'credit' then amount_paise else -amount_paise end)
                                   from ledger_entries where society_id = p_society and entry_date <= public.period_end(m.period)), 0)
    ) order by m.period), '[]'::jsonb)
    from (select public.period_of((date_trunc('month', public.ist_today()) - make_interval(months => g))::date) as period
            from generate_series(0, v_n - 1) g) m
  );
end $$;

-- ---------------------------------------------------------------------------
-- Payee history (e.g. all payments to the security guard)
-- ---------------------------------------------------------------------------
create or replace function public.payee_history(p_society uuid, p_payee text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_payee text := public.clean_text(p_payee);
begin
  perform public.assert_member(p_society);
  if v_payee is null then return '{"entries": [], "months": []}'::jsonb; end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('entry_id', e.id, 'date', e.entry_date, 'amount_paise', e.amount_paise,
                                'category', e.category, 'payee', e.payee, 'mode', e.payment_mode, 'note', e.note,
                                'is_reversed', public.is_entry_reversed(e.id)) order by e.entry_date desc)
                           from ledger_entries e where e.society_id = p_society and e.direction = 'debit' and e.reverses_entry_id is null
                            and e.payee ilike v_payee), '[]'::jsonb),
    'months', coalesce((select jsonb_agg(jsonb_build_object('period', x.period, 'label', public.period_label(x.period), 'amount_paise', x.amt) order by x.period desc)
                          from (select public.period_of(e.entry_date) as period,
                                       sum(case when e.direction = 'debit' then e.amount_paise else -e.amount_paise end)::bigint as amt
                                  from ledger_entries e where e.society_id = p_society and e.payee ilike v_payee
                                   and e.category not in ('maintenance', 'event_contribution', 'transfer')
                                 group by 1) x), '[]'::jsonb)
  );
end $$;

create or replace function public.payee_list(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((select jsonb_agg(jsonb_build_object('payee', payee, 'count', n, 'total_paise', total) order by n desc)
    from (select payee, count(*) as n, sum(amount_paise)::bigint as total from ledger_entries
           where society_id = p_society and direction = 'debit' and payee is not null and reverses_entry_id is null
           group by payee limit 100) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Pay screen for a member
-- ---------------------------------------------------------------------------
create or replace function public.my_pay_info(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
          'pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0) from dues d
                             where d.unit_id = v_unit and d.fund_id = v_general and not d.waived),
          'oldest_period', (select d.period from dues d where d.unit_id = v_unit and d.fund_id = v_general and not d.waived
                              and d.amount_paise > public.due_paid_paise(d.id) order by d.due_date limit 1)) as p
        where v_unit is not null
        union all
        select jsonb_build_object('fund_id', e.fund_id, 'kind', 'event', 'label', e.title, 'event_id', e.id,
          'pending_paise', greatest(d.amount_paise - public.due_paid_paise(d.id), 0))
          from dues d join events e on e.id = d.event_id
         where d.unit_id = v_unit and not d.waived and d.amount_paise > public.due_paid_paise(d.id)
      ) t), '[]'::jsonb)
  );
end $$;
