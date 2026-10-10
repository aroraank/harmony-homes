-- Surface who confirmed a recurring expense payment (already logged in expense_drafts.resolved_by /
-- ledger_entries.created_by), so admins and members can see which admin marked it paid, not just that
-- it was paid.
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
                                                   and entry_date >= (v_period || '-01')::date
                                                   and category not in ('maintenance', 'event_contribution', 'opening_balance', 'adjustment', 'transfer')),
                                'status_counts', coalesce(v_counts, '{}'::jsonb)),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'target_paise', e.total_cost_paise,
                                         'per_unit_share_paise', e.per_unit_share_paise, 'due_date', e.due_date,
                                         'collected_paise', (select coalesce(sum(case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end), 0)
                                                               from ledger_entries l where l.fund_id = e.fund_id and l.category = 'event_contribution'))
                                         order by e.due_date)
                          from events e where e.society_id = p_society and e.status = 'open'), '[]'::jsonb),
    'fixed_expenses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', t.title, 'amount_paise', t.amount_paise, 'day_of_month', t.day_of_month,
               'draft_id', dr.id, 'draft_status', dr.status, 'draft_amount_paise', dr.amount_paise,
               'confirmed_amount_paise', le.amount_paise, 'confirmed_note', le.note, 'confirmed_at', dr.resolved_at,
               'confirmed_by', rp.full_name)
             order by t.day_of_month)
        from expense_templates t
        left join expense_drafts dr on dr.template_id = t.id and dr.period = v_period
        left join ledger_entries le on le.id = dr.ledger_entry_id
        left join profiles rp on rp.id = dr.resolved_by
       where t.society_id = p_society and t.is_active), '[]'::jsonb),
    'unacked_notices', (select count(*) from notice_receipts r join notices n on n.id = r.notice_id
                         where r.user_id = auth.uid() and r.society_id = p_society and r.acknowledged_at is null
                           and n.archived_at is null and n.require_ack),
    'unread_notifications', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'admin', v_admin,
    'mine', v_mine
  );
end $$;
