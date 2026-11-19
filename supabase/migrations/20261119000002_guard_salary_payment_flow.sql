-- 2026-11-19 (part 2): the security guard salary payment flow.
--  * The guard salary can never be skipped (new "skippable" flag on the template).
--  * pending_fixed_expenses: every unpaid month, oldest first, with balance and shortfall (admins only).
--  * Reminders also cover older unpaid months, not just the current one.
--  * pay_fixed_expense: marks a month as paid in ONE step. Pays on the chosen date, tells everyone when it is late
--    ("collection was late"), and can record extra payments from flats (a gift, kept apart from their dues) when
--    the society balance is short. Everyone is told which flat added how much.
--  * report_payment_blocked / send_low_balance_alert: tell everyone why it is not paid yet / that it is urgent.
--  * record_expense: "paid late" wording, and a fix for a latent error when no draft is used.
-- Depends on 20261119000001. Safe to run more than once.

-- 1) Template flag
alter table public.expense_templates add column if not exists skippable boolean not null default true;
update public.expense_templates set skippable = false where title ilike 'security guard salary%';

-- 2) Skip: the flag wins over everything else
create or replace function public.skip_expense_draft(p_draft_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d record; v_title text; v_skippable boolean; v_reason text := public.clean_text(p_reason); v_label text;
begin
  select * into d from expense_drafts where id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'Already handled.'; end if;
  select title, skippable into v_title, v_skippable from expense_templates where id = d.template_id;
  if not v_skippable then
    raise exception using errcode = 'P0001',
      message = format('%s cannot be skipped. Please mark it as paid, or tell everyone why it cannot be paid yet.', v_title);
  end if;
  if d.period <> public.period_of(public.ist_today()) then
    raise exception using errcode = 'P0001', message = 'Only this month''s payment can be skipped. Please mark the older one as paid.';
  end if;
  if extract(day from public.ist_today())::int > 15 then
    raise exception using errcode = 'P0001', message = 'This payment can only be skipped up to the 15th of the month. Please mark it as paid.';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Please give a reason (at least 5 characters). Everyone in the society will see it.';
  end if;
  v_label := to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  update expense_drafts set status = 'skipped', resolved_by = auth.uid(), resolved_at = now() where id = d.id;
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'expense_skipped', null,
    format('%s for %s not paid yet', v_title, v_label), left(v_reason, 300), '/events/recurring');
  perform public.audit_append(d.society_id, 'expense_draft_skipped', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', v_title, 'period', d.period, 'reason', v_reason));
end $$;

-- Which fund can pay this recurring expense best: its own fund, or an open event fund named like it
-- (the guard's monthly collections live in such funds). Returns the fund with the most money.
create or replace function public._best_expense_fund(p_society uuid, p_template uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('fund_id', x.id, 'balance_paise', x.bal)
    from (
      select f.id, public.fund_balance_paise(f.id) as bal, (f.id = t.fund_id) as is_own
        from expense_templates t
        join funds f on f.society_id = p_society and f.is_active
                    and (f.id = t.fund_id or (f.kind = 'event' and f.name ilike t.title || '%'))
       where t.id = p_template
       order by public.fund_balance_paise(f.id) desc, (f.id = t.fund_id) desc
       limit 1) x
$$;
revoke execute on function public._best_expense_fund(uuid, uuid) from public, anon, authenticated;

-- 3) Every unpaid month for the admin banner and popup
create or replace function public.pending_fixed_expenses(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := public.period_of(public.ist_today()); v_day int := extract(day from public.ist_today())::int;
begin
  perform public.assert_perm(p_society, 'record_expense');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'draft_id', d.id, 'template_id', t.id, 'title', t.title, 'period', d.period,
             'period_label', to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY'),
             'amount_paise', d.amount_paise, 'day_of_month', t.day_of_month, 'skippable', t.skippable,
             'overdue', (d.period < v_cur or v_day > t.day_of_month),
             'late_if_paid_today', public.ist_today() > to_date(d.period || '-15', 'YYYY-MM-DD'),
             'can_skip', (t.skippable and d.period = v_cur and v_day <= 15),
             'can_report_blocked', (d.period < v_cur or v_day >= 10),
             'fund_id', (public._best_expense_fund(p_society, t.id) ->> 'fund_id')::uuid,
             'balance_paise', (public._best_expense_fund(p_society, t.id) ->> 'balance_paise')::bigint,
             'shortfall_paise', greatest(0, d.amount_paise - (public._best_expense_fund(p_society, t.id) ->> 'balance_paise')::bigint))
           order by d.period, t.title)
      from expense_drafts d join expense_templates t on t.id = d.template_id
     where d.society_id = p_society and d.status = 'pending'), '[]'::jsonb);
end $$;

-- 4) Reminders keep going for older unpaid months
create or replace function public.remind_overdue_expenses() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_period text := public.period_of(public.ist_today()); v_today int := extract(day from public.ist_today())::int;
        s record; d record; v_n int := 0;
begin
  for s in select id from societies loop
    for d in
      select t.title, dr.period from expense_drafts dr
        join expense_templates t on t.id = dr.template_id
       where dr.society_id = s.id and dr.status = 'pending'
         and (dr.period < v_period or (dr.period = v_period and t.day_of_month < v_today))
    loop
      perform public._notify(s.id, public._all_member_ids(s.id), 'expense_overdue', null,
        format('%s payment pending', d.title) || case when d.period < v_period
          then format(' (%s)', to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY')) else '' end,
        format('Please make sure the %s payment is made on time. Hurry up!', d.title), '/events/recurring');
      v_n := v_n + 1;
    end loop;
  end loop;
  return jsonb_build_object('reminders_sent', v_n);
end $$;
revoke execute on function public.remind_overdue_expenses() from public, anon, authenticated;

-- 5) record_expense: "paid late" wording; and no more error when no draft is used
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
  v_dtitle text;
  v_title text;
  v_late boolean := coalesce(current_setting('hh.expense_late', true), '') = 'on';
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
    v_dtitle := v_draft.title;
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

  v_title := coalesce(v_dtitle, public.clean_text(p_payee), 'Expense');
  perform public._notify(v_fund.society_id, public._all_member_ids(v_fund.society_id), 'expense_recorded', v_entry,
    format('%s paid%s: %s', v_title, case when v_late then ' late' else '' end, public.fmt_inr(p_amount_paise)),
    coalesce(public.clean_text(p_note), '') || case when p_payee is not null then format(' · Paid to %s', public.clean_text(p_payee)) else '' end,
    '/ledger');
  return jsonb_build_object('entry_id', v_entry);
end $$;

-- 6) Mark a fixed monthly payment as paid, with optional extra payments from flats
drop function if exists public.pay_fixed_expense(uuid, bigint, date, text, text, text, text, text, text, jsonb, text, boolean);
drop function if exists public.pay_fixed_expense(uuid, bigint, date, text, text, text, text, text, text, jsonb, text, boolean, uuid, text, text);
create or replace function public.pay_fixed_expense(
  p_draft_id uuid,
  p_amount_paise bigint,
  p_entry_date date,
  p_payment_mode text,
  p_reference_no text default null,
  p_note text default null,
  p_attachment_path text default null,
  p_idempotency_key text default null,
  p_backdate_reason text default null,
  p_contributions jsonb default '[]'::jsonb,
  p_shortfall_reason text default null,
  p_allow_duplicate_reference boolean default false,
  p_fund_id uuid default null,
  p_category text default null,
  p_payee text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  d record;
  c jsonb;
  v_i int := 0;
  v_total bigint := 0;
  v_count int := 0;
  v_balance bigint;
  v_short bigint;
  v_late boolean;
  v_note text := public.clean_text(p_note);
  v_label text;
  v_existing uuid;
  v_res jsonb;
  v_unit uuid; v_amt bigint; v_mode text; v_ref text; v_receipt text; v_entry uuid; v_unit_code text;
  v_list text; v_seen uuid[] := '{}'; v_fund uuid; v_cat text; v_payee text;
begin
  select dr.id, dr.society_id, dr.period, dr.status, dr.amount_paise as draft_amount, t.title, t.fund_id, t.category, t.payee
    into d
    from expense_drafts dr join expense_templates t on t.id = dr.template_id
   where dr.id = p_draft_id for update of dr;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  perform public._check_idem(p_idempotency_key);
  select id into v_existing from ledger_entries where society_id = d.society_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then return jsonb_build_object('entry_id', v_existing, 'replayed', true); end if;
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'This payment was already handled.'; end if;
  perform public._check_amount(p_amount_paise);
  perform public._check_entry_date(d.society_id, p_entry_date, p_backdate_reason);
  if p_amount_paise <> d.draft_amount and char_length(coalesce(v_note, '')) < 5 then
    raise exception using errcode = 'P0001',
      message = format('This is different from the usual %s. Please add a reason (at least 5 characters) so members can see why.', public.fmt_inr(d.draft_amount));
  end if;
  v_label := to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  v_fund := coalesce(p_fund_id, (public._best_expense_fund(d.society_id, (select template_id from expense_drafts where id = p_draft_id)) ->> 'fund_id')::uuid, d.fund_id);
  if not exists (select 1 from funds where id = v_fund and society_id = d.society_id and is_active) then
    raise exception using errcode = 'P0001', message = 'Fund not found or no longer active.';
  end if;
  v_cat := coalesce(nullif(public.clean_text(p_category), ''), d.category);
  v_payee := coalesce(nullif(public.clean_text(p_payee), ''), d.payee, d.title);

  -- validate the extra payments first
  if jsonb_typeof(coalesce(p_contributions, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'Extra payments are not valid.';
  end if;
  if jsonb_array_length(coalesce(p_contributions, '[]'::jsonb)) > 60 then
    raise exception using errcode = 'P0001', message = 'Too many extra payments at once.';
  end if;
  for c in select * from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb)) loop
    v_unit := (c ->> 'unit_id')::uuid; v_amt := (c ->> 'amount_paise')::bigint;
    if not exists (select 1 from units where id = v_unit and society_id = d.society_id) then
      raise exception using errcode = 'P0001', message = 'An extra payment names a flat that is not in this society.';
    end if;
    if v_unit = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'Each flat can be added only once. Please combine its amounts.';
    end if;
    v_seen := v_seen || v_unit;
    perform public._check_amount(v_amt);
    v_total := v_total + v_amt;
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then perform public.assert_perm(d.society_id, 'record_payment'); end if;

  v_balance := public.fund_balance_paise(v_fund);
  v_short := greatest(0, p_amount_paise - v_balance - v_total);
  if v_short > 0 and char_length(coalesce(public.clean_text(p_shortfall_reason), '')) < 5 then
    raise exception using errcode = 'P0001',
      message = format('NOT_ENOUGH_BALANCE: The society balance %s plus extra payments %s is %s short of %s. Add extra payments, or give a reason to go ahead.',
                       public.fmt_inr(v_balance), public.fmt_inr(v_total), public.fmt_inr(v_short), public.fmt_inr(p_amount_paise));
  end if;

  -- extra payments from flats: plain credits with a receipt, kept apart from the flat's dues
  v_i := 0;
  for c in select * from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb)) loop
    v_i := v_i + 1;
    v_unit := (c ->> 'unit_id')::uuid; v_amt := (c ->> 'amount_paise')::bigint;
    v_mode := public._norm_mode(coalesce(c ->> 'payment_mode', p_payment_mode));
    v_ref := public._norm_ref(c ->> 'reference_no');
    if v_ref is null and v_mode not in ('cash', 'cheque', 'other') then
      select code into v_unit_code from units where id = v_unit;
      raise exception using errcode = 'P0001', message = format('UTR / transaction ID is required for the extra payment from %s.', v_unit_code);
    end if;
    if not coalesce(p_allow_duplicate_reference, false) and v_ref is not null and public._reference_in_use(d.society_id, v_ref, null) then
      raise exception using errcode = 'P0001', message = 'DUPLICATE_REFERENCE: This UTR / reference already exists in the ledger or a pending claim.';
    end if;
    v_receipt := public._next_receipt_no(d.society_id, p_entry_date);
    insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id,
                                payment_mode, reference_no, note, created_by, receipt_no, receipt_token,
                                idempotency_key, backdate_reason)
    values (d.society_id, v_fund, p_entry_date, 'credit', v_amt, 'extra_contribution', v_unit,
            v_mode, v_ref, left(format('Extra payment to cover %s for %s', d.title, v_label), 500), auth.uid(), v_receipt,
            upper(encode(extensions.gen_random_bytes(6), 'hex')), left(p_idempotency_key, 100) || ':c' || v_i,
            public.clean_text(p_backdate_reason))
    returning id into v_entry;
    perform public._notify(d.society_id, public._unit_user_ids(v_unit), 'payment_received', v_entry,
      format('%s received as an extra payment', public.fmt_inr(v_amt)),
      format('Thank you for helping cover %s for %s. Receipt %s', d.title, v_label, v_receipt), '/receipts/' || v_entry);
  end loop;

  -- late? (after the 15th of the month it belongs to)
  v_late := p_entry_date > to_date(d.period || '-15', 'YYYY-MM-DD');
  if v_late then
    v_note := left(coalesce(v_note || ' · ', '') || 'Paid late — collection was late.', 500);
  end if;
  if v_short > 0 then
    v_note := left(coalesce(v_note || ' · ', '') || format('Society balance was %s short: %s', public.fmt_inr(v_short), public.clean_text(p_shortfall_reason)), 500);
  end if;

  perform set_config('hh.expense_late', case when v_late then 'on' else 'off' end, true);
  v_res := public.record_expense(v_fund, v_cat, v_payee, p_amount_paise, p_entry_date,
             p_payment_mode, p_reference_no, v_note, p_attachment_path, p_idempotency_key, p_backdate_reason,
             p_draft_id, p_allow_duplicate_reference);
  perform set_config('hh.expense_late', 'off', true);

  -- one notice to everyone: which flat added how much
  if v_count > 0 then
    select string_agg(format('%s %s', u.code, public.fmt_inr((x ->> 'amount_paise')::bigint)), ' · ' order by u.sort_order, u.code)
      into v_list
      from jsonb_array_elements(p_contributions) x join units u on u.id = (x ->> 'unit_id')::uuid;
    if char_length(v_list) > 380 then v_list := left(v_list, 380) || ' …'; end if;
    perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'expense_contributions', (v_res ->> 'entry_id')::uuid,
      format('Extra payments for %s: %s added', d.title, public.fmt_inr(v_total)),
      v_list || format('. Added to cover %s for %s because collections were short.', d.title, v_label), '/ledger');
  end if;

  perform public.audit_append(d.society_id, 'fixed_expense_paid', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', d.title, 'period', d.period, 'amount_paise', p_amount_paise, 'late', v_late,
                       'extra_payments_paise', v_total, 'flats', v_count, 'short_paise', v_short));
  return v_res || jsonb_build_object('late', v_late, 'contributed_paise', v_total, 'short_paise', v_short);
end $$;

-- 7) "I cannot pay yet" notice (from the 10th) and the red urgent alert, each at most once a day per payment
create or replace function public.report_payment_blocked(p_draft_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record; v_reason text := public.clean_text(p_reason); v_bal bigint; v_label text; v_body text;
begin
  select dr.id, dr.society_id, dr.period, dr.status, dr.amount_paise, t.title, t.fund_id
    into d from expense_drafts dr join expense_templates t on t.id = dr.template_id where dr.id = p_draft_id;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'Already handled.'; end if;
  if d.period = public.period_of(public.ist_today()) and extract(day from public.ist_today())::int < 10 then
    raise exception using errcode = 'P0001', message = 'This option is available from the 10th of the month.';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Please give a reason (at least 5 characters). Everyone in the society will see it.';
  end if;
  if exists (select 1 from notifications where society_id = d.society_id and kind = 'expense_blocked' and ref_id = d.id
              and created_at > now() - interval '20 hours') then
    raise exception using errcode = 'P0001', message = 'Everyone was already told today.';
  end if;
  v_bal := (public._best_expense_fund(d.society_id, (select template_id from expense_drafts where id = d.id)) ->> 'balance_paise')::bigint;
  v_label := to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  v_body := left(v_reason, 250) || format(' · Society balance %s, needed %s.', public.fmt_inr(v_bal), public.fmt_inr(d.amount_paise));
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'expense_blocked', d.id,
    format('%s for %s could not be paid yet', d.title, v_label), v_body, '/events/recurring');
  perform public.audit_append(d.society_id, 'expense_payment_blocked', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', d.title, 'period', d.period, 'reason', v_reason, 'balance_paise', v_bal));
end $$;

create or replace function public.send_low_balance_alert(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record; v_bal bigint; v_label text;
begin
  select dr.id, dr.society_id, dr.period, dr.status, dr.amount_paise, t.title, t.fund_id
    into d from expense_drafts dr join expense_templates t on t.id = dr.template_id where dr.id = p_draft_id;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'Already handled.'; end if;
  v_bal := (public._best_expense_fund(d.society_id, (select template_id from expense_drafts where id = d.id)) ->> 'balance_paise')::bigint;
  if v_bal >= d.amount_paise then
    raise exception using errcode = 'P0001', message = 'The society balance already covers this payment.';
  end if;
  if exists (select 1 from notifications where society_id = d.society_id and kind = 'expense_urgent' and ref_id = d.id
              and created_at > now() - interval '20 hours') then
    raise exception using errcode = 'P0001', message = 'The urgent alert was already sent today.';
  end if;
  v_label := to_char(to_date(d.period || '-01', 'YYYY-MM-DD'), 'FMMonth YYYY');
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'expense_urgent', d.id,
    format('URGENT: %s for %s cannot be paid', d.title, v_label),
    format('The society balance including this month''s collection is %s, still less than the %s needed. If you have not paid your maintenance yet, please pay as soon as possible. Otherwise we may lose the security guard.',
           public.fmt_inr(v_bal), public.fmt_inr(d.amount_paise)),
    '/dues');
  perform public.audit_append(d.society_id, 'expense_urgent_alert', 'expense_drafts', d.id::text, null,
    jsonb_build_object('title', d.title, 'period', d.period, 'balance_paise', v_bal, 'needed_paise', d.amount_paise));
  return jsonb_build_object('balance_paise', v_bal, 'needed_paise', d.amount_paise);
end $$;

-- 8) Grants
revoke execute on function public.pending_fixed_expenses(uuid) from public, anon;
revoke execute on function public.pay_fixed_expense(uuid, bigint, date, text, text, text, text, text, text, jsonb, text, boolean, uuid, text, text) from public, anon;
revoke execute on function public.report_payment_blocked(uuid, text) from public, anon;
revoke execute on function public.send_low_balance_alert(uuid) from public, anon;
revoke execute on function public.skip_expense_draft(uuid, text) from public, anon;
grant execute on function public.pending_fixed_expenses(uuid) to authenticated;
grant execute on function public.pay_fixed_expense(uuid, bigint, date, text, text, text, text, text, text, jsonb, text, boolean, uuid, text, text) to authenticated;
grant execute on function public.report_payment_blocked(uuid, text) to authenticated;
grant execute on function public.send_low_balance_alert(uuid) to authenticated;
grant execute on function public.skip_expense_draft(uuid, text) to authenticated;
