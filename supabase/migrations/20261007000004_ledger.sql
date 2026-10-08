-- Harmony Homes — money RPCs. Every money-changing write is a security definer
-- function that validates role, society, closed-month lock and amounts in one transaction.

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
create or replace function public.fmt_inr(p_paise bigint) returns text
language plpgsql immutable set search_path = public as $$
declare
  v_neg boolean := p_paise < 0;
  v_abs bigint := abs(p_paise);
  v_rupees text := (v_abs / 100)::text;
  v_paise int := (v_abs % 100)::int;
  v_last3 text;
  v_rest text;
  v_out text := '';
begin
  if length(v_rupees) > 3 then
    v_last3 := right(v_rupees, 3);
    v_rest := left(v_rupees, length(v_rupees) - 3);
    while length(v_rest) > 2 loop
      v_out := ',' || right(v_rest, 2) || v_out;
      v_rest := left(v_rest, length(v_rest) - 2);
    end loop;
    v_out := v_rest || v_out || ',' || v_last3;
  else
    v_out := v_rupees;
  end if;
  if v_paise > 0 then v_out := v_out || '.' || lpad(v_paise::text, 2, '0'); end if;
  return case when v_neg then '-' else '' end || '₹' || v_out;
end $$;

create or replace function public.period_label(p text) returns text
language sql immutable set search_path = public as $$
  select to_char(public.period_start(p), 'Mon YYYY')
$$;

create or replace function public.general_fund_id(p_society uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from funds where society_id = p_society and kind = 'general'
$$;

create or replace function public.is_month_closed(p_society uuid, p_period text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from month_closings where society_id = p_society and period = p_period and reopened_at is null)
$$;

create or replace function public._check_amount(p_amount bigint) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = 'P0001', message = 'Amount must be more than zero.';
  end if;
  if p_amount > 1000000000 then
    raise exception using errcode = 'P0001', message = 'Amount cannot exceed ₹1,00,00,000 per entry.';
  end if;
end $$;

create or replace function public._check_entry_date(p_society uuid, p_date date, p_reason text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_date is null then
    raise exception using errcode = 'P0001', message = 'Date is required.';
  end if;
  if p_date > public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Date cannot be in the future.';
  end if;
  if p_date < date '2000-01-01' then
    raise exception using errcode = 'P0001', message = 'Date is too far in the past.';
  end if;
  if public.is_month_closed(p_society, public.period_of(p_date)) then
    raise exception using errcode = 'P0001',
      message = format('%s is closed. Ask the super admin to reopen it first.', public.period_label(public.period_of(p_date)));
  end if;
  if p_date < public.ist_today() - 30 and char_length(coalesce(public.clean_text(p_reason), '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Entries dated more than 30 days ago need a reason (at least 5 characters).';
  end if;
end $$;

create or replace function public._norm_mode(p_mode text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := lower(public.clean_text(p_mode));
begin
  if v is null or v not in ('upi', 'gpay', 'phonepe', 'paytm', 'cash', 'bank', 'cheque', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose a valid payment mode.';
  end if;
  return v;
end $$;

create or replace function public._norm_ref(p_ref text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g'));
begin
  if v = '' then return null; end if;
  if v !~ '^[A-Z0-9]{6,30}$' then
    raise exception using errcode = 'P0001', message = 'UTR / reference must be 6–30 letters or digits.';
  end if;
  return v;
end $$;

create or replace function public._check_idem(p_key text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 120 then
    raise exception using errcode = 'P0001', message = 'Missing request key. Please refresh and try again.';
  end if;
end $$;

create or replace function public.fy_of(p_date date) returns text
language sql immutable set search_path = public as $$
  select case when extract(month from p_date) >= 4
    then extract(year from p_date)::int::text || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_date)::int - 1)::text || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0')
  end
$$;

-- Gap-free sequential receipt number, assigned inside the posting transaction.
create or replace function public._next_receipt_no(p_society uuid, p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_fy text := public.fy_of(p_date);
  v_no int;
  v_prefix text;
begin
  insert into receipt_counters (society_id, fy, last_no) values (p_society, v_fy, 1)
  on conflict (society_id, fy) do update set last_no = receipt_counters.last_no + 1
  returning last_no into v_no;
  select receipt_prefix into v_prefix from society_settings where society_id = p_society;
  return coalesce(v_prefix, 'HH') || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
end $$;

create or replace function public.is_entry_reversed(p_entry_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ledger_entries r where r.reverses_entry_id = p_entry_id)
$$;

-- Amount of a due settled by non-reversed payments
create or replace function public.due_paid_paise(p_due_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.amount_paise), 0)::bigint
    from due_allocations a
   where a.due_id = p_due_id
     and not public.is_entry_reversed(a.ledger_entry_id)
$$;

-- Unallocated part of a unit-payment credit (0 when reversed)
create or replace function public.entry_unallocated_paise(p_entry_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select case when public.is_entry_reversed(e.id) then 0
    else e.amount_paise - coalesce((select sum(a.amount_paise) from due_allocations a where a.ledger_entry_id = e.id), 0)
  end::bigint
  from ledger_entries e where e.id = p_entry_id
$$;

-- Advance credit a unit holds in a fund
create or replace function public.unit_advance_paise(p_unit uuid, p_fund uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(public.entry_unallocated_paise(e.id)), 0)::bigint
    from ledger_entries e
   where e.unit_id = p_unit and e.fund_id = p_fund and e.direction = 'credit'
     and e.category in ('maintenance', 'event_contribution') and e.reverses_entry_id is null
$$;

create or replace function public.due_label(p_due_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when d.due_type = 'monthly' then public.period_label(d.period) else ev.title end
    from dues d left join events ev on ev.id = d.event_id where d.id = p_due_id
$$;

-- Greedy FIFO allocation: oldest unallocated credit -> oldest unpaid due, same unit and fund.
create or replace function public._allocate(p_unit uuid, p_fund uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  d record;
  v_rem bigint;
  v_amt bigint;
  v_count int := 0;
  v_society uuid;
begin
  select society_id into v_society from units where id = p_unit for update;
  for c in
    select e.id from ledger_entries e
     where e.unit_id = p_unit and e.fund_id = p_fund and e.direction = 'credit'
       and e.category in ('maintenance', 'event_contribution')
       and e.reverses_entry_id is null
       and not public.is_entry_reversed(e.id)
     order by e.entry_date, e.created_at, e.id
  loop
    v_rem := public.entry_unallocated_paise(c.id);
    continue when v_rem <= 0;
    for d in
      select x.id, x.amount_paise - public.due_paid_paise(x.id) as remaining
        from dues x
       where x.unit_id = p_unit and x.fund_id = p_fund and not x.waived
       order by x.due_date, x.created_at, x.id
    loop
      exit when v_rem <= 0;
      continue when d.remaining <= 0;
      v_amt := least(v_rem, d.remaining);
      insert into due_allocations (society_id, ledger_entry_id, due_id, amount_paise)
      values (v_society, c.id, d.id, v_amt);
      v_rem := v_rem - v_amt;
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications (in-app inbox + push outbox)
-- ---------------------------------------------------------------------------
create or replace function public._notify(
  p_society uuid, p_users uuid[], p_kind text, p_ref uuid, p_title text, p_body text, p_url text
) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into notifications (society_id, user_id, kind, ref_id, title, body, url)
  select p_society, u, p_kind, p_ref, left(p_title, 140), left(p_body, 400), p_url
    from (select distinct unnest(p_users) as u) x
   where u is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public._unit_user_ids(p_unit uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from memberships where unit_id = p_unit and status = 'active'
$$;

create or replace function public._perm_user_ids(p_society uuid, p_perm text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id), '{}')
    from memberships m
   where m.society_id = p_society and m.status = 'active' and m.role in ('admin', 'super_admin')
     and public.user_has_perm(m.user_id, p_society, p_perm)
$$;

create or replace function public._super_admin_ids(p_society uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from memberships
   where society_id = p_society and status = 'active' and role = 'super_admin'
$$;

create or replace function public._admin_ids(p_society uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from memberships
   where society_id = p_society and status = 'active' and role in ('admin', 'super_admin')
$$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create or replace function public._payment_result(p_entry_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'entry_id', e.id,
    'receipt_no', e.receipt_no,
    'receipt_token', e.receipt_token,
    'amount_paise', e.amount_paise,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object('due_id', a.due_id, 'label', public.due_label(a.due_id), 'amount_paise', a.amount_paise)
                       order by d.due_date)
        from due_allocations a join dues d on d.id = a.due_id
       where a.ledger_entry_id = e.id), '[]'::jsonb),
    'advance_paise', public.unit_advance_paise(e.unit_id, e.fund_id)
  )
  from ledger_entries e where e.id = p_entry_id
$$;

create or replace function public._reference_in_use(p_society uuid, p_ref text, p_exclude_claim uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_ref is not null and (
    exists (select 1 from ledger_entries e
             where e.society_id = p_society and e.reference_no = p_ref
               and e.reverses_entry_id is null and not public.is_entry_reversed(e.id))
    or exists (select 1 from payment_claims c
                where c.society_id = p_society and c.reference_no = p_ref and c.status = 'pending'
                  and (p_exclude_claim is null or c.id <> p_exclude_claim))
  )
$$;

create or replace function public._post_unit_payment(
  p_society uuid, p_unit uuid, p_fund uuid, p_amount bigint, p_date date, p_mode text,
  p_reference text, p_note text, p_attachment text, p_idem text, p_backdate_reason text,
  p_allow_duplicate boolean, p_claim_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_existing uuid;
  v_fund record;
  v_event record;
  v_mode text;
  v_ref text;
  v_category text;
  v_entry uuid;
  v_receipt text;
  v_result jsonb;
  v_covers text;
  v_unit record;
begin
  perform public._check_idem(p_idem);
  select id into v_existing from ledger_entries where society_id = p_society and idempotency_key = p_idem;
  if v_existing is not null then
    return public._payment_result(v_existing) || jsonb_build_object('replayed', true);
  end if;

  select * into v_unit from units where id = p_unit and society_id = p_society for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Flat not found in this society.';
  end if;

  select * into v_fund from funds where id = p_fund and society_id = p_society;
  if not found then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  if not v_fund.is_active then
    raise exception using errcode = 'P0001', message = 'This fund is no longer active.';
  end if;
  if v_fund.kind = 'event' then
    select * into v_event from events where id = v_fund.event_id;
    if v_event.status = 'draft' then
      raise exception using errcode = 'P0001', message = 'This event has not been opened yet.';
    end if;
    v_category := 'event_contribution';
  else
    v_category := 'maintenance';
  end if;

  perform public._check_amount(p_amount);
  perform public._check_entry_date(p_society, p_date, p_backdate_reason);
  v_mode := public._norm_mode(p_mode);
  v_ref := public._norm_ref(p_reference);
  if v_ref is null and v_mode not in ('cash', 'cheque', 'other') then
    raise exception using errcode = 'P0001', message = 'UTR / transaction ID is required for UPI and bank payments.';
  end if;
  if not coalesce(p_allow_duplicate, false) and public._reference_in_use(p_society, v_ref, p_claim_id) then
    raise exception using errcode = 'P0001', message = 'DUPLICATE_REFERENCE: This UTR / reference already exists in the ledger or a pending claim.';
  end if;
  if p_attachment is not null and p_attachment not like p_society::text || '/%' then
    raise exception using errcode = 'P0001', message = 'Invalid attachment.';
  end if;

  v_receipt := public._next_receipt_no(p_society, p_date);

  insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id,
                              payment_mode, reference_no, note, attachment_path, created_by, receipt_no,
                              receipt_token, claim_id, idempotency_key, backdate_reason)
  values (p_society, p_fund, p_date, 'credit', p_amount, v_category, p_unit,
          v_mode, v_ref, left(public.clean_text(p_note), 500), p_attachment, auth.uid(), v_receipt,
          upper(encode(extensions.gen_random_bytes(6), 'hex')), p_claim_id, p_idem,
          public.clean_text(p_backdate_reason))
  returning id into v_entry;

  perform public._allocate(p_unit, p_fund);
  v_result := public._payment_result(v_entry);

  select string_agg(x ->> 'label', ', ') into v_covers from jsonb_array_elements(v_result -> 'allocations') x;
  perform public._notify(p_society, public._unit_user_ids(p_unit), 'payment_received', v_entry,
    format('%s received%s', public.fmt_inr(p_amount), case when v_covers is not null then ' for ' || v_covers else '' end),
    format('Receipt %s', v_receipt),
    '/receipts/' || v_entry);
  return v_result;
end $$;

create or replace function public.record_payment(
  p_unit_id uuid,
  p_amount_paise bigint,
  p_entry_date date,
  p_payment_mode text,
  p_reference_no text default null,
  p_note text default null,
  p_attachment_path text default null,
  p_idempotency_key text default null,
  p_fund_id uuid default null,
  p_backdate_reason text default null,
  p_allow_duplicate_reference boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then
    raise exception using errcode = 'P0001', message = 'Flat not found.';
  end if;
  perform public.assert_perm(v_society, 'record_payment');
  return public._post_unit_payment(v_society, p_unit_id, coalesce(p_fund_id, public.general_fund_id(v_society)),
    p_amount_paise, p_entry_date, p_payment_mode, p_reference_no, p_note, p_attachment_path,
    p_idempotency_key, p_backdate_reason, p_allow_duplicate_reference, null);
end $$;

-- What a payment would cover, without saving anything
create or replace function public.preview_allocation(p_unit_id uuid, p_amount_paise bigint, p_fund_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_society uuid;
  v_fund uuid;
  v_rem bigint := coalesce(p_amount_paise, 0);
  v_out jsonb := '[]'::jsonb;
  d record;
  v_amt bigint;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Flat not found.'; end if;
  perform public.assert_member(v_society);
  if not (public.has_perm(v_society, 'record_payment') or public.has_perm(v_society, 'approve_claims')
          or p_unit_id in (select public.my_unit_ids(v_society))) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  v_fund := coalesce(p_fund_id, public.general_fund_id(v_society));
  for d in
    select x.id, x.amount_paise, public.due_paid_paise(x.id) as paid, public.due_label(x.id) as label, x.due_date
      from dues x
     where x.unit_id = p_unit_id and x.fund_id = v_fund and not x.waived
     order by x.due_date, x.created_at, x.id
  loop
    continue when d.amount_paise - d.paid <= 0;
    exit when v_rem <= 0;
    v_amt := least(v_rem, d.amount_paise - d.paid);
    v_out := v_out || jsonb_build_object('due_id', d.id, 'label', d.label, 'due_paise', d.amount_paise,
                                         'already_paid_paise', d.paid, 'amount_paise', v_amt, 'due_date', d.due_date);
    v_rem := v_rem - v_amt;
  end loop;
  return jsonb_build_object('allocations', v_out, 'advance_paise', v_rem,
                            'existing_advance_paise', public.unit_advance_paise(p_unit_id, v_fund));
end $$;

create or replace function public.check_duplicate_reference(p_society uuid, p_reference text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ref text;
begin
  perform public.assert_member(p_society);
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  begin
    v_ref := public._norm_ref(p_reference);
  exception when others then
    return '[]'::jsonb;
  end;
  if v_ref is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object('source', 'ledger', 'id', e.id, 'date', e.entry_date, 'amount_paise', e.amount_paise,
                                'unit_code', u.code, 'payee', e.payee) as x
        from ledger_entries e left join units u on u.id = e.unit_id
       where e.society_id = p_society and e.reference_no = v_ref
         and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)
      union all
      select jsonb_build_object('source', 'claim', 'id', c.id, 'date', c.paid_on, 'amount_paise', c.amount_paise,
                                'unit_code', u.code, 'status', c.status)
        from payment_claims c join units u on u.id = c.unit_id
       where c.society_id = p_society and c.reference_no = v_ref and c.status = 'pending'
    ) t), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Expenses, adjustments, transfers
-- ---------------------------------------------------------------------------
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
    select * into v_draft from expense_drafts where id = p_draft_id and society_id = v_fund.society_id for update;
    if not found or v_draft.status <> 'pending' then
      raise exception using errcode = 'P0001', message = 'This draft was already handled.';
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
  return jsonb_build_object('entry_id', v_entry);
end $$;

create or replace function public.record_adjustment(
  p_fund_id uuid, p_direction text, p_category text, p_amount_paise bigint, p_entry_date date,
  p_note text, p_idempotency_key text, p_backdate_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fund record; v_existing uuid; v_entry uuid;
begin
  select * into v_fund from funds where id = p_fund_id;
  if not found then raise exception using errcode = 'P0001', message = 'Fund not found.'; end if;
  perform public.assert_perm(v_fund.society_id, 'record_adjustment');
  perform public._check_idem(p_idempotency_key);
  select id into v_existing from ledger_entries where society_id = v_fund.society_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then return jsonb_build_object('entry_id', v_existing, 'replayed', true); end if;
  if p_category not in ('opening_balance', 'adjustment') then
    raise exception using errcode = 'P0001', message = 'Category must be opening balance or adjustment.';
  end if;
  if p_direction not in ('credit', 'debit') then
    raise exception using errcode = 'P0001', message = 'Direction must be credit or debit.';
  end if;
  if p_category = 'opening_balance' and p_direction <> 'credit' then
    raise exception using errcode = 'P0001', message = 'Opening balance must be a credit.';
  end if;
  if p_category = 'opening_balance' and exists (
      select 1 from ledger_entries e where e.fund_id = v_fund.id and e.category = 'opening_balance'
         and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)) then
    raise exception using errcode = 'P0001', message = 'An opening balance already exists for this fund. Reverse it first to change it.';
  end if;
  if char_length(coalesce(public.clean_text(p_note), '')) < 3 then
    raise exception using errcode = 'P0001', message = 'A note is required for adjustments.';
  end if;
  perform public._check_amount(p_amount_paise);
  perform public._check_entry_date(v_fund.society_id, p_entry_date, coalesce(p_backdate_reason, case when p_category = 'opening_balance' then 'Opening balance' end));

  insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, note, created_by, idempotency_key, backdate_reason)
  values (v_fund.society_id, v_fund.id, p_entry_date, p_direction, p_amount_paise, p_category,
          left(public.clean_text(p_note), 500), auth.uid(), p_idempotency_key, public.clean_text(p_backdate_reason))
  returning id into v_entry;
  return jsonb_build_object('entry_id', v_entry);
end $$;

create or replace function public.fund_balance_paise(p_fund_id uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when direction = 'credit' then amount_paise else -amount_paise end), 0)::bigint
    from ledger_entries where fund_id = p_fund_id
$$;

create or replace function public._transfer(
  p_society uuid, p_from uuid, p_to uuid, p_amount bigint, p_date date, p_note text, p_idem text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_group uuid := gen_random_uuid();
begin
  if p_from = p_to then raise exception using errcode = 'P0001', message = 'Choose two different funds.'; end if;
  if not exists (select 1 from funds where id = p_from and society_id = p_society)
     or not exists (select 1 from funds where id = p_to and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  perform public._check_amount(p_amount);
  perform public._check_entry_date(p_society, p_date, 'Fund transfer');
  insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, note, created_by, transfer_group, idempotency_key)
  values (p_society, p_from, p_date, 'debit', p_amount, 'transfer', left(p_note, 500), auth.uid(), v_group, p_idem || ':out'),
         (p_society, p_to, p_date, 'credit', p_amount, 'transfer', left(p_note, 500), auth.uid(), v_group, p_idem || ':in');
  return v_group;
end $$;

create or replace function public.transfer_between_funds(
  p_from_fund_id uuid, p_to_fund_id uuid, p_amount_paise bigint, p_entry_date date, p_note text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_society uuid; v_group uuid;
begin
  select society_id into v_society from funds where id = p_from_fund_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Fund not found.'; end if;
  perform public.assert_perm(v_society, 'manage_events');
  perform public._check_idem(p_idempotency_key);
  select transfer_group into v_group from ledger_entries where society_id = v_society and idempotency_key = p_idempotency_key || ':out';
  if v_group is not null then return jsonb_build_object('transfer_group', v_group, 'replayed', true); end if;
  if char_length(coalesce(public.clean_text(p_note), '')) < 3 then
    raise exception using errcode = 'P0001', message = 'A note is required for transfers.';
  end if;
  v_group := public._transfer(v_society, p_from_fund_id, p_to_fund_id, p_amount_paise, p_entry_date,
                              public.clean_text(p_note), p_idempotency_key);
  return jsonb_build_object('transfer_group', v_group);
end $$;

-- ---------------------------------------------------------------------------
-- Reversal (the only way to "correct" an entry)
-- ---------------------------------------------------------------------------
create or replace function public.reverse_entry(p_entry_id uuid, p_reason text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e record;
  leg record;
  v_reason text := public.clean_text(p_reason);
  v_ids uuid[] := '{}';
  v_new uuid;
  v_n int := 0;
  v_group uuid;
begin
  select * into e from ledger_entries where id = p_entry_id;
  if not found then raise exception using errcode = 'P0001', message = 'Entry not found.'; end if;
  perform public.assert_perm(e.society_id, 'reverse_entry');
  perform public._check_idem(p_idempotency_key);
  if exists (select 1 from ledger_entries where society_id = e.society_id and idempotency_key = p_idempotency_key || ':1') then
    return jsonb_build_object('replayed', true);
  end if;
  if e.reverses_entry_id is not null then
    raise exception using errcode = 'P0001', message = 'A reversal cannot itself be reversed. Record a new entry instead.';
  end if;
  if char_length(coalesce(v_reason, '')) < 5 or char_length(v_reason) > 300 then
    raise exception using errcode = 'P0001', message = 'Give a reason (5–300 characters).';
  end if;
  if public.is_month_closed(e.society_id, public.period_of(e.entry_date)) then
    raise exception using errcode = 'P0001',
      message = format('%s is closed. Ask the super admin to reopen it first.', public.period_label(public.period_of(e.entry_date)));
  end if;
  if public.is_entry_reversed(e.id) then
    raise exception using errcode = 'P0001', message = 'This entry is already reversed.';
  end if;

  if e.transfer_group is not null then v_group := gen_random_uuid(); end if;

  for leg in
    select * from ledger_entries
     where (e.transfer_group is not null and transfer_group = e.transfer_group and reverses_entry_id is null)
        or (e.transfer_group is null and id = e.id)
     order by created_at, id
     for update
  loop
    if public.is_entry_reversed(leg.id) then
      raise exception using errcode = 'P0001', message = 'Part of this transfer is already reversed.';
    end if;
    v_n := v_n + 1;
    insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id, payee,
                                payment_mode, reference_no, note, created_by, reverses_entry_id, transfer_group, idempotency_key)
    values (leg.society_id, leg.fund_id, leg.entry_date,
            case when leg.direction = 'credit' then 'debit' else 'credit' end,
            leg.amount_paise, leg.category, leg.unit_id, leg.payee, leg.payment_mode, leg.reference_no,
            left('Reversal: ' || v_reason, 500), auth.uid(), leg.id, v_group, p_idempotency_key || ':' || v_n)
    returning id into v_new;
    v_ids := v_ids || v_new;

    if leg.unit_id is not null and leg.category in ('maintenance', 'event_contribution') then
      perform public._allocate(leg.unit_id, leg.fund_id);
      perform public._notify(leg.society_id, public._unit_user_ids(leg.unit_id), 'receipt_cancelled', leg.id,
        format('Receipt %s cancelled', coalesce(leg.receipt_no, '')),
        format('%s payment was reversed: %s', public.fmt_inr(leg.amount_paise), v_reason),
        '/receipts/' || leg.id);
    end if;
  end loop;

  return jsonb_build_object('reversal_ids', to_jsonb(v_ids));
end $$;

-- ---------------------------------------------------------------------------
-- Dues
-- ---------------------------------------------------------------------------
create or replace function public._generate_monthly_dues(p_society uuid, p_period text, p_notify boolean) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_settings record;
  v_general uuid := public.general_fund_id(p_society);
  v_due_date date;
  v_count int;
  u record;
  d record;
begin
  if not public.is_valid_period(p_period) then
    raise exception using errcode = 'P0001', message = 'Invalid month.';
  end if;
  select * into v_settings from society_settings where society_id = p_society;
  if p_period < v_settings.start_month then
    raise exception using errcode = 'P0001', message = format('Dues start from %s.', public.period_label(v_settings.start_month));
  end if;
  if p_period > public.period_of(public.ist_today()) then
    raise exception using errcode = 'P0001', message = 'Dues cannot be generated for a future month.';
  end if;
  if public.is_month_closed(p_society, p_period) then
    raise exception using errcode = 'P0001', message = 'That month is closed.';
  end if;
  v_due_date := public.period_start(p_period) + (v_settings.due_day - 1);

  insert into dues (society_id, unit_id, fund_id, due_type, period, amount_paise, due_date)
  select p_society, un.id, v_general, 'monthly', p_period,
         coalesce(ut.monthly_due_paise, v_settings.monthly_due_paise), v_due_date
    from units un join unit_types ut on ut.id = un.unit_type_id
   where un.society_id = p_society and un.is_billable
  on conflict do nothing;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    -- settle new dues from any advance credit, oldest first
    for u in select id from units where society_id = p_society and is_billable loop
      perform public._allocate(u.id, v_general);
    end loop;
    if p_notify then
      for d in
        select x.id, x.unit_id, x.amount_paise - public.due_paid_paise(x.id) as pending
          from dues x where x.society_id = p_society and x.period = p_period and x.due_type = 'monthly'
      loop
        continue when d.pending <= 0;
        perform public._notify(p_society, public._unit_user_ids(d.unit_id), 'due_created', d.id,
          format('Maintenance for %s: %s', public.period_label(p_period), public.fmt_inr(d.pending)),
          format('Due by %s', to_char(v_due_date, 'DD Mon YYYY')), '/dues');
      end loop;
    end if;
  end if;
  return v_count;
end $$;

create or replace function public.generate_monthly_dues(p_society uuid, p_period text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform public.assert_perm(p_society, 'generate_dues');
  v := public._generate_monthly_dues(p_society, p_period, true);
  return jsonb_build_object('created', v);
end $$;

create or replace function public.waive_due(p_due_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare d record; v_reason text := public.clean_text(p_reason);
begin
  select * into d from dues where id = p_due_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Due not found.'; end if;
  perform public.assert_perm(d.society_id, 'generate_dues');
  if d.waived then raise exception using errcode = 'P0001', message = 'Already waived.'; end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a reason for the waiver.';
  end if;
  if public.due_paid_paise(d.id) > 0 then
    raise exception using errcode = 'P0001', message = 'This due already has payments against it. Reverse the payment first.';
  end if;
  if d.due_type = 'monthly' and public.is_month_closed(d.society_id, d.period) then
    raise exception using errcode = 'P0001', message = 'That month is closed.';
  end if;
  update dues set waived = true, waived_reason = left(v_reason, 300), waived_by = auth.uid(), waived_at = now()
   where id = d.id;
end $$;

-- ---------------------------------------------------------------------------
-- Payment claims ("I paid")
-- ---------------------------------------------------------------------------
create or replace function public.submit_payment_claim(
  p_society uuid,
  p_amount_paise bigint,
  p_paid_on date,
  p_payment_mode text,
  p_reference_no text,
  p_screenshot_path text default null,
  p_note text default null,
  p_fund_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid;
  v_fund record;
  v_mode text;
  v_ref text;
  v_id uuid;
  v_code text;
begin
  perform public.assert_member(p_society);
  select unit_id into v_unit from memberships
   where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null limit 1;
  if v_unit is null then
    raise exception using errcode = 'P0001', message = 'Only flat logins can submit payment claims.';
  end if;
  select * into v_fund from funds where id = coalesce(p_fund_id, public.general_fund_id(p_society)) and society_id = p_society;
  if not found or not v_fund.is_active then
    raise exception using errcode = 'P0001', message = 'Choose what this payment is for.';
  end if;
  perform public._check_amount(p_amount_paise);
  if p_paid_on is null or p_paid_on > public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Payment date cannot be in the future.';
  end if;
  if p_paid_on < public.ist_today() - 365 then
    raise exception using errcode = 'P0001', message = 'Payment date is too old. Contact the admin.';
  end if;
  v_mode := public._norm_mode(p_payment_mode);
  v_ref := public._norm_ref(p_reference_no);
  if v_ref is null and v_mode <> 'cash' then
    raise exception using errcode = 'P0001', message = 'Enter the UTR / transaction ID from your payment app.';
  end if;
  if v_ref is not null and (public._reference_in_use(p_society, v_ref, null) or exists (
       select 1 from payment_claims where society_id = p_society and reference_no = v_ref and status = 'approved')) then
    raise exception using errcode = 'P0001', message = 'This UTR / transaction ID has already been submitted.';
  end if;
  if p_screenshot_path is not null and p_screenshot_path not like p_society::text || '/claims/' || auth.uid()::text || '/%' then
    raise exception using errcode = 'P0001', message = 'Invalid screenshot.';
  end if;
  if (select count(*) from payment_claims where unit_id = v_unit and status = 'pending') >= 10 then
    raise exception using errcode = 'P0001', message = 'You have too many pending claims. Please wait for the admin to verify them.';
  end if;

  insert into payment_claims (society_id, unit_id, fund_id, submitted_by, amount_paise, paid_on, payment_mode,
                              reference_no, screenshot_path, note)
  values (p_society, v_unit, v_fund.id, auth.uid(), p_amount_paise, p_paid_on, v_mode, v_ref, p_screenshot_path,
          left(public.clean_text(p_note), 500))
  returning id into v_id;

  select code into v_code from units where id = v_unit;
  perform public._notify(p_society, public._perm_user_ids(p_society, 'approve_claims'), 'claim_submitted', v_id,
    format('Payment claim: %s paid %s', v_code, public.fmt_inr(p_amount_paise)),
    'Verify in the bank / UPI app and approve.', '/admin/claims');
  return v_id;
end $$;

create or replace function public.approve_claim(
  p_claim_id uuid,
  p_amount_paise bigint default null,
  p_fund_id uuid default null,
  p_entry_date date default null,
  p_note text default null,
  p_allow_duplicate_reference boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_result jsonb; v_date date;
begin
  select * into c from payment_claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Claim not found.'; end if;
  perform public.assert_perm(c.society_id, 'approve_claims');
  if c.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'This claim was already reviewed.';
  end if;
  v_date := coalesce(p_entry_date, c.paid_on);
  v_result := public._post_unit_payment(
    c.society_id, c.unit_id, coalesce(p_fund_id, c.fund_id), coalesce(p_amount_paise, c.amount_paise), v_date,
    c.payment_mode, c.reference_no, coalesce(public.clean_text(p_note), c.note), c.screenshot_path,
    'claim:' || c.id::text,
    'Payment claim submitted ' || to_char(c.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
    p_allow_duplicate_reference, c.id);
  update payment_claims set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         ledger_entry_id = (v_result ->> 'entry_id')::uuid
   where id = c.id;
  return v_result;
end $$;

create or replace function public.reject_claim(p_claim_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_reason text := public.clean_text(p_reason);
begin
  select * into c from payment_claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Claim not found.'; end if;
  perform public.assert_perm(c.society_id, 'approve_claims');
  if c.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'This claim was already reviewed.';
  end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a reason so the member knows what to fix.';
  end if;
  update payment_claims set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), reject_reason = left(v_reason, 300)
   where id = c.id;
  perform public._notify(c.society_id, array[c.submitted_by], 'claim_rejected', c.id,
    format('Payment claim of %s not approved', public.fmt_inr(c.amount_paise)), v_reason, '/dues');
end $$;

-- ---------------------------------------------------------------------------
-- Events (special collections)
-- ---------------------------------------------------------------------------
create or replace function public.event_share_paise(p_total bigint, p_expected int, p_rounding bigint) returns bigint
language sql immutable set search_path = public as $$
  -- ceil(total / expected), then round up to the nearest multiple of rounding
  select ((((p_total + p_expected - 1) / p_expected) + p_rounding - 1) / p_rounding) * p_rounding
$$;

create or replace function public._open_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ev record; v_fund uuid; u record;
begin
  select * into ev from events where id = p_event_id for update;
  if ev.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'This event is already open.';
  end if;
  insert into funds (society_id, name, kind, event_id) values (ev.society_id, ev.title, 'event', ev.id)
  returning id into v_fund;
  update events set fund_id = v_fund, status = 'open', opened_at = now() where id = ev.id;
  insert into dues (society_id, unit_id, fund_id, due_type, event_id, amount_paise, due_date)
  select ev.society_id, eu.unit_id, v_fund, 'event', ev.id, ev.per_unit_share_paise, ev.due_date
    from event_units eu where eu.event_id = ev.id and eu.expected;
  for u in select unit_id from event_units where event_id = ev.id and expected loop
    perform public._notify(ev.society_id, public._unit_user_ids(u.unit_id), 'event_due', ev.id,
      format('%s: %s per flat', ev.title, public.fmt_inr(ev.per_unit_share_paise)),
      format('Due by %s', to_char(ev.due_date, 'DD Mon YYYY')), '/events/' || ev.id);
  end loop;
end $$;

create or replace function public.create_event(
  p_society uuid,
  p_title text,
  p_description text,
  p_total_cost_paise bigint,
  p_scope_type text,
  p_unit_type_ids uuid[] default '{}',
  p_unit_ids uuid[] default '{}',
  p_excluded jsonb default '[]',
  p_due_date date default null,
  p_rounding_paise bigint default null,
  p_open boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := public.clean_text(p_title);
  v_scope uuid[];
  v_excl record;
  v_excluded uuid[] := '{}';
  v_reasons jsonb := '{}';
  v_rounding bigint;
  v_expected int;
  v_share bigint;
  v_id uuid;
begin
  perform public.assert_perm(p_society, 'manage_events');
  if char_length(coalesce(v_title, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Title must be at least 3 characters.';
  end if;
  perform public._check_amount(p_total_cost_paise);
  if p_due_date is null or p_due_date < public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Choose a due date from today onwards.';
  end if;

  if p_scope_type = 'all' then
    select array_agg(id order by sort_order, code) into v_scope from units where society_id = p_society and is_billable;
  elsif p_scope_type = 'unit_types' then
    if coalesce(array_length(p_unit_type_ids, 1), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'Pick at least one flat type.';
    end if;
    if exists (select 1 from unnest(p_unit_type_ids) t where t not in (select id from unit_types where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat type.';
    end if;
    select array_agg(id order by sort_order, code) into v_scope from units
     where society_id = p_society and is_billable and unit_type_id = any(p_unit_type_ids);
  elsif p_scope_type = 'custom' then
    if exists (select 1 from unnest(p_unit_ids) t where t not in (select id from units where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat in selection.';
    end if;
    select array_agg(id order by sort_order, code) into v_scope from units
     where society_id = p_society and id = any(p_unit_ids);
  else
    raise exception using errcode = 'P0001', message = 'Choose who this event applies to.';
  end if;
  if coalesce(array_length(v_scope, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'No flats are in scope.';
  end if;

  for v_excl in select (x ->> 'unit_id')::uuid as unit_id, public.clean_text(x ->> 'reason') as reason
                  from jsonb_array_elements(coalesce(p_excluded, '[]'::jsonb)) x loop
    if not (v_excl.unit_id = any(v_scope)) then
      raise exception using errcode = 'P0001', message = 'An excluded flat is not in scope.';
    end if;
    if char_length(coalesce(v_excl.reason, '')) < 2 then
      raise exception using errcode = 'P0001', message = 'Give a reason for every excluded flat.';
    end if;
    if not (v_excl.unit_id = any(v_excluded)) then
      v_excluded := v_excluded || v_excl.unit_id;
      v_reasons := v_reasons || jsonb_build_object(v_excl.unit_id::text, left(v_excl.reason, 200));
    end if;
  end loop;

  v_expected := array_length(v_scope, 1) - coalesce(array_length(v_excluded, 1), 0);
  if v_expected < 1 then
    raise exception using errcode = 'P0001', message = 'At least one flat must be expected to pay.';
  end if;
  select coalesce(p_rounding_paise, share_rounding_paise) into v_rounding from society_settings where society_id = p_society;
  if v_rounding < 100 or v_rounding > 1000000 then
    raise exception using errcode = 'P0001', message = 'Rounding must be between ₹1 and ₹10,000.';
  end if;
  v_share := public.event_share_paise(p_total_cost_paise, v_expected, v_rounding);

  insert into events (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, rounding_paise,
                      in_scope_count, expected_count, per_unit_share_paise, due_date, created_by)
  values (p_society, v_title, left(public.clean_body(p_description), 2000), p_scope_type,
          case when p_scope_type = 'unit_types' then p_unit_type_ids else '{}' end,
          p_total_cost_paise, v_rounding, array_length(v_scope, 1), v_expected, v_share, p_due_date, auth.uid())
  returning id into v_id;

  insert into event_units (event_id, unit_id, society_id, expected, exclusion_reason)
  select v_id, s, p_society, not (s = any(v_excluded)), v_reasons ->> s::text from unnest(v_scope) s;

  if p_open then perform public._open_event(v_id); end if;
  return v_id;
end $$;

create or replace function public.open_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from events where id = p_event_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_perm(v_society, 'manage_events');
  perform public._open_event(p_event_id);
end $$;

create or replace function public.delete_event_draft(p_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ev record;
begin
  select * into ev from events where id = p_event_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_perm(ev.society_id, 'manage_events');
  if ev.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Only draft events can be deleted.';
  end if;
  delete from event_units where event_id = ev.id;
  delete from events where id = ev.id;
end $$;

create or replace function public.close_event(p_event_id uuid, p_settle boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev record;
  v_balance bigint;
  v_general uuid;
  v_note text := public.clean_text(p_note);
  v_moved bigint := 0;
begin
  select * into ev from events where id = p_event_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_perm(ev.society_id, 'manage_events');
  if ev.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'Only open events can be closed.';
  end if;
  v_general := public.general_fund_id(ev.society_id);
  v_balance := public.fund_balance_paise(ev.fund_id);
  if p_settle and v_balance > 0 then
    perform public._transfer(ev.society_id, ev.fund_id, v_general, v_balance, public.ist_today(),
      coalesce(v_note, 'Event surplus moved to General: ' || ev.title), 'event-close:' || ev.id::text);
    v_moved := v_balance;
  elsif p_settle and v_balance < 0 then
    perform public._transfer(ev.society_id, v_general, ev.fund_id, -v_balance, public.ist_today(),
      coalesce(v_note, 'Event shortfall covered from General: ' || ev.title), 'event-close:' || ev.id::text);
    v_moved := v_balance;
  end if;
  update events set status = 'closed', closed_at = now(), closed_by = auth.uid(), close_note = left(v_note, 500)
   where id = ev.id;
  return jsonb_build_object('balance_paise', v_balance, 'moved_paise', v_moved);
end $$;

-- ---------------------------------------------------------------------------
-- Recurring expenses
-- ---------------------------------------------------------------------------
create or replace function public.upsert_expense_template(
  p_society uuid, p_id uuid, p_title text, p_fund_id uuid, p_category text, p_payee text,
  p_amount_paise bigint, p_day_of_month int, p_payment_mode text, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_perm(p_society, 'record_expense');
  if char_length(coalesce(public.clean_text(p_title), '')) < 2 then
    raise exception using errcode = 'P0001', message = 'Title is required.';
  end if;
  if not exists (select 1 from funds where id = p_fund_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  if not exists (select 1 from expense_categories where society_id = p_society and code = p_category) then
    raise exception using errcode = 'P0001', message = 'Choose a valid expense category.';
  end if;
  perform public._check_amount(p_amount_paise);
  if p_day_of_month is null or p_day_of_month not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Day must be between 1 and 28.';
  end if;
  if p_id is null then
    insert into expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode, is_active, created_by)
    values (p_society, public.clean_text(p_title), p_fund_id, p_category, public.clean_text(p_payee), p_amount_paise,
            p_day_of_month, case when p_payment_mode is null then null else public._norm_mode(p_payment_mode) end,
            coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
  else
    update expense_templates set title = public.clean_text(p_title), fund_id = p_fund_id, category = p_category,
           payee = public.clean_text(p_payee), amount_paise = p_amount_paise, day_of_month = p_day_of_month,
           payment_mode = case when p_payment_mode is null then null else public._norm_mode(p_payment_mode) end,
           is_active = coalesce(p_is_active, true)
     where id = p_id and society_id = p_society
    returning id into v_id;
    if v_id is null then raise exception using errcode = 'P0001', message = 'Template not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public._generate_expense_drafts(p_society uuid, p_period text, p_only_due boolean) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into expense_drafts (society_id, template_id, period, amount_paise)
  select t.society_id, t.id, p_period, t.amount_paise
    from expense_templates t
   where t.society_id = p_society and t.is_active
     and (not p_only_due or p_period < public.period_of(public.ist_today())
          or t.day_of_month <= extract(day from public.ist_today()))
  on conflict (template_id, period) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.generate_expense_drafts(p_society uuid, p_period text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_perm(p_society, 'record_expense');
  if not public.is_valid_period(p_period) or p_period > public.period_of(public.ist_today()) then
    raise exception using errcode = 'P0001', message = 'Invalid month.';
  end if;
  return jsonb_build_object('created', public._generate_expense_drafts(p_society, p_period, false));
end $$;

create or replace function public.skip_expense_draft(p_draft_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  select * into d from expense_drafts where id = p_draft_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Draft not found.'; end if;
  perform public.assert_perm(d.society_id, 'record_expense');
  if d.status <> 'pending' then raise exception using errcode = 'P0001', message = 'Already handled.'; end if;
  update expense_drafts set status = 'skipped', resolved_by = auth.uid(), resolved_at = now() where id = d.id;
end $$;

-- ---------------------------------------------------------------------------
-- Month closing
-- ---------------------------------------------------------------------------
-- (month_report is defined in the reports migration; closing captures it as a snapshot)
