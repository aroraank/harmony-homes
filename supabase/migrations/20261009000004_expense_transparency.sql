-- Fixed monthly expenses (e.g. "Security guard salary"): full transparency workflow.
--   * Draft is visible from the 1st of the month (not only once the day-of-month is reached) —
--     the app colours it by how close/overdue it is.
--   * Confirming it never happens automatically — an admin must always review and confirm, and can
--     edit the amount; if the amount differs from the usual one, a reason is required.
--   * Every expense (recurring or ad-hoc) is announced to every member once recorded.
--   * If the usual day passes with nothing confirmed, every member gets a reminder (wired to run
--     three times a day via pg_cron below).

-- 1) Drafts become visible to admins from day 1 of the month, not just once the usual day is reached.
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int; v_activated int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0; v_activated := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_series := public._generate_series_events(s.id);
      v_activated := public._activate_due_series_events(s.id);
      -- false: create this month's drafts right away (visible from day 1), not only once the usual day arrives.
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
    exception when others then
      v_out := v_out || jsonb_build_object('society_id', s.id, 'error', sqlerrm);
      continue;
    end;
    v_out := v_out || jsonb_build_object('society_id', s.id, 'dues', v_dues, 'drafts', v_drafts, 'reminders', v_rem,
                                         'recurring_events', v_series, 'activated_events', v_activated, 'locations_purged', v_purged);
  end loop;
  return v_out;
end $$;

-- 2) Confirming an expense: require a reason when the amount differs from the usual (draft) amount,
--    and tell every member once it's recorded — recurring or ad-hoc, any payee, any reason.
create or replace function public.record_expense(
  p_fund_id uuid,
  p_category text,
  p_payee text,
  p_amount_paise bigint,
  p_entry_date date,
  p_payment_mode text,
  p_reference_no text default null,
  p_note text default null,
  p_attachment_path text default null,
  p_idempotency_key text default null,
  p_backdate_reason text default null,
  p_draft_id uuid default null,
  p_allow_duplicate_reference boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fund record;
  v_existing uuid;
  v_entry uuid;
  v_ref text;
  v_mode text;
  v_draft record;
  v_title text;
begin
  select * into v_fund from funds where id = p_fund_id;
  if not found then raise exception using errcode = 'P0001', message = 'Fund not found.'; end if;
  perform public.assert_perm(v_fund.society_id, 'record_expense');
  perform public._check_idem(p_idempotency_key);
  select id into v_existing from ledger_entries where society_id = v_fund.society_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return jsonb_build_object('entry_id', v_existing, 'replayed', true);
  end if;
  if not v_fund.is_active then raise exception using errcode = 'P0001', message = 'This fund is no longer active.'; end if;
  if not exists (select 1 from expense_categories where society_id = v_fund.society_id and code = p_category) then
    raise exception using errcode = 'P0001', message = 'Choose a valid expense category.';
  end if;
  perform public._check_amount(p_amount_paise);
  perform public._check_entry_date(v_fund.society_id, p_entry_date, p_backdate_reason);
  v_mode := public._norm_mode(p_payment_mode);
  v_ref := public._norm_ref(p_reference_no);
  if not coalesce(p_allow_duplicate_reference, false) and v_ref is not null and exists (
       select 1 from ledger_entries e where e.society_id = v_fund.society_id and e.reference_no = v_ref
          and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_REFERENCE: This UTR / reference already exists in the ledger.';
  end if;
  if p_attachment_path is not null and p_attachment_path not like v_fund.society_id::text || '/%' then
    raise exception using errcode = 'P0001', message = 'Invalid attachment.';
  end if;
  if p_draft_id is not null then
    select d.*, t.title into v_draft from expense_drafts d join expense_templates t on t.id = d.template_id
      where d.id = p_draft_id and d.society_id = v_fund.society_id for update;
    if not found or v_draft.status <> 'pending' then
      raise exception using errcode = 'P0001', message = 'This draft was already handled.';
    end if;
    if p_amount_paise <> v_draft.amount_paise and char_length(coalesce(public.clean_text(p_note), '')) < 5 then
      raise exception using errcode = 'P0001',
        message = format('This is different from the usual %s. Please add a reason (at least 5 characters) so members can see why.', public.fmt_inr(v_draft.amount_paise));
    end if;
  end if;

  insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, payee,
                              payment_mode, reference_no, note, attachment_path, created_by, idempotency_key, backdate_reason)
  values (v_fund.society_id, v_fund.id, p_entry_date, 'debit', p_amount_paise, p_category, left(public.clean_text(p_payee), 120),
          v_mode, v_ref, left(public.clean_text(p_note), 500), p_attachment_path, auth.uid(), p_idempotency_key,
          public.clean_text(p_backdate_reason))
  returning id into v_entry;

  if p_draft_id is not null then
    update expense_drafts set status = 'confirmed', ledger_entry_id = v_entry, resolved_by = auth.uid(), resolved_at = now()
     where id = p_draft_id;
  end if;

  v_title := coalesce(v_draft.title, public.clean_text(p_payee), 'Expense');
  perform public._notify(v_fund.society_id, public._all_member_ids(v_fund.society_id), 'expense_recorded', v_entry,
    format('%s paid: %s', v_title, public.fmt_inr(p_amount_paise)),
    coalesce(public.clean_text(p_note), '') || case when p_payee is not null then format(' · Paid to %s', public.clean_text(p_payee)) else '' end,
    '/ledger');
  return jsonb_build_object('entry_id', v_entry);
end $$;

-- 3) If the usual day passes with the draft still pending, remind every member (not just admins).
--    Scheduled three times a day below — each run sends one round, so three runs a day = three reminders.
create or replace function public.remind_overdue_expenses() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_period text := public.period_of(public.ist_today()); v_today int := extract(day from public.ist_today())::int;
        s record; d record; v_n int := 0;
begin
  for s in select id from societies loop
    for d in
      select t.title from expense_drafts dr
        join expense_templates t on t.id = dr.template_id
       where dr.society_id = s.id and dr.period = v_period and dr.status = 'pending' and t.day_of_month < v_today
    loop
      perform public._notify(s.id, public._all_member_ids(s.id), 'expense_overdue', null,
        format('%s payment pending', d.title),
        format('Please make sure the %s payment is made on time. Hurry up!', d.title), '/events/recurring');
      v_n := v_n + 1;
    end loop;
  end loop;
  return jsonb_build_object('reminders_sent', v_n);
end $$;
revoke execute on function public.remind_overdue_expenses() from public, anon, authenticated;

-- Three times a day (10:00, 15:00, 20:00 IST = 04:30, 09:30, 14:30 UTC). Safe to run again — pg_cron
-- replaces the job definition when the name already exists.
select cron.schedule('hh-expense-reminders', '30 4,9,14 * * *', $$ select public.remind_overdue_expenses(); $$);

-- 4) Everyone (not just admins) can see this month's fixed-expense status on Home, so members know
--    a payment like the guard's salary is pending — read-only for them, confirmable for admins.
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
               'confirmed_amount_paise', le.amount_paise, 'confirmed_note', le.note, 'confirmed_at', dr.resolved_at)
             order by t.day_of_month)
        from expense_templates t
        left join expense_drafts dr on dr.template_id = t.id and dr.period = v_period
        left join ledger_entries le on le.id = dr.ledger_entry_id
       where t.society_id = p_society and t.is_active), '[]'::jsonb),
    'unacked_notices', (select count(*) from notice_receipts r join notices n on n.id = r.notice_id
                         where r.user_id = auth.uid() and r.society_id = p_society and r.acknowledged_at is null
                           and n.archived_at is null and n.require_ack),
    'unread_notifications', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'admin', v_admin,
    'mine', v_mine
  );
end $$;
