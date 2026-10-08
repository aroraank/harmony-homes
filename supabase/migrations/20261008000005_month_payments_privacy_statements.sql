-- Harmony Homes — pay-for-a-month, surplus handling, dues privacy, statements.
--
-- 1. A payment (or "I paid" claim) can name the month(s)/events it is for. Months that are not
--    named stay open; fully paid months can never be picked again. Without a choice the old
--    oldest-first rule still applies, so nothing existing changes.
-- 2. Any surplus (advance) or part-adjustment against older pending dues notifies admins and
--    super admins and the member.
-- 3. Who paid extra is visible to every member (surplus_board); who owes is visible only to the
--    flat itself and admins (RLS on dues/allocations + masked reports).
-- 4. Statement RPCs for date-range PDF downloads (society ledger and per-flat), plus an audit
--    row for every download.

alter table public.payment_claims add column if not exists due_ids uuid[];
do $$ begin
  alter table public.payment_claims add constraint payment_claims_due_ids_chk
    check (due_ids is null or cardinality(due_ids) <= 36);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.due_remaining_paise(p_due uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select case when d.waived then 0 else greatest(d.amount_paise - public.due_paid_paise(d.id), 0) end::bigint
    from dues d where d.id = p_due
$$;

-- Put one payment against the dues the payer named (oldest first among those).
create or replace function public._allocate_targeted(p_unit uuid, p_fund uuid, p_entry uuid, p_due_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare
  d record;
  v_rem bigint;
  v_amt bigint;
  v_count int := 0;
  v_society uuid;
begin
  select society_id into v_society from units where id = p_unit;
  v_rem := public.entry_unallocated_paise(p_entry);
  for d in
    select x.id, public.due_remaining_paise(x.id) as remaining
      from dues x
     where x.id = any(p_due_ids) and x.unit_id = p_unit and x.fund_id = p_fund and not x.waived
     order by x.due_date, x.created_at, x.id
  loop
    exit when v_rem <= 0;
    continue when d.remaining <= 0;
    v_amt := least(v_rem, d.remaining);
    insert into due_allocations (society_id, ledger_entry_id, due_id, amount_paise)
    values (v_society, p_entry, d.id, v_amt);
    v_rem := v_rem - v_amt;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Refuse a list of dues that is not entirely open dues of this flat and fund.
create or replace function public._check_due_choice(p_unit uuid, p_fund uuid, p_due_ids uuid[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_due_ids is null or cardinality(p_due_ids) = 0 then return; end if;
  if cardinality(p_due_ids) > 36 then
    raise exception using errcode = 'P0001', message = 'Choose at most 36 months at a time.';
  end if;
  if exists (select 1 from unnest(p_due_ids) x group by x having count(*) > 1) then
    raise exception using errcode = 'P0001', message = 'A month was selected twice.';
  end if;
  if (select count(*) from dues d
       where d.id = any(p_due_ids) and d.unit_id = p_unit and d.fund_id = p_fund
         and not d.waived and public.due_remaining_paise(d.id) > 0) <> cardinality(p_due_ids) then
    raise exception using errcode = 'P0001',
      message = 'One of the selected months is already paid or does not belong to this flat. Please refresh and choose again.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Posting: _post_unit_payment now accepts the chosen dues and raises surplus notifications
-- ---------------------------------------------------------------------------
drop function if exists public._post_unit_payment(uuid, uuid, uuid, bigint, date, text, text, text, text, text, text, boolean, uuid);

create or replace function public._post_unit_payment(
  p_society uuid, p_unit uuid, p_fund uuid, p_amount bigint, p_date date, p_mode text,
  p_reference text, p_note text, p_attachment text, p_idem text, p_backdate_reason text,
  p_allow_duplicate boolean, p_claim_id uuid, p_due_ids uuid[] default null
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
  v_due_ids uuid[] := nullif(p_due_ids, '{}'::uuid[]);
  v_left bigint;
  v_other bigint := 0;
  v_other_labels text;
  v_msg text;
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
  perform public._check_due_choice(p_unit, p_fund, v_due_ids);
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

  if v_due_ids is not null then
    perform public._allocate_targeted(p_unit, p_fund, v_entry, v_due_ids);
  end if;
  perform public._allocate(p_unit, p_fund);
  v_result := public._payment_result(v_entry);

  select string_agg(x ->> 'label', ', ') into v_covers from jsonb_array_elements(v_result -> 'allocations') x;
  v_left := public.entry_unallocated_paise(v_entry);
  if v_due_ids is not null then
    select coalesce(sum(a.amount_paise), 0), string_agg(public.due_label(a.due_id), ', ')
      into v_other, v_other_labels
      from due_allocations a where a.ledger_entry_id = v_entry and not (a.due_id = any(v_due_ids));
  end if;

  perform public._notify(p_society, public._unit_user_ids(p_unit), 'payment_received', v_entry,
    format('%s received%s', public.fmt_inr(p_amount), case when v_covers is not null then ' for ' || v_covers else '' end),
    format('Receipt %s', v_receipt)
      || case when v_other > 0 then format(' · %s adjusted against older pending (%s)', public.fmt_inr(v_other), v_other_labels) else '' end
      || case when v_left > 0 then format(' · %s kept as advance for future dues', public.fmt_inr(v_left)) else '' end,
    '/receipts/' || v_entry);

  -- surplus / adjustment: tell every admin and super admin
  if v_left > 0 or v_other > 0 then
    v_msg := format('%s paid %s', v_unit.code, public.fmt_inr(p_amount));
    perform public._notify(p_society, public._admin_ids(p_society), 'surplus_payment', v_entry,
      case when v_left > 0 then format('Surplus: %s — %s kept as advance', v_msg, public.fmt_inr(v_left))
           else format('Adjusted: %s — %s applied to older pending', v_msg, public.fmt_inr(v_other)) end,
      coalesce(case when v_covers is not null then 'Covers ' || v_covers || '. ' end, '')
        || case when v_other > 0 then format('%s was adjusted against older pending dues (%s). ', public.fmt_inr(v_other), v_other_labels) else '' end
        || case when v_left > 0 then format('%s is now held as advance credit for the flat. ', public.fmt_inr(v_left)) else '' end
        || format('Receipt %s.', v_receipt),
      '/reports/unit/' || p_unit);
  end if;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- record_payment / preview / claims: optional list of chosen dues
-- ---------------------------------------------------------------------------
drop function if exists public.record_payment(uuid, bigint, date, text, text, text, text, text, uuid, text, boolean);
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
  p_allow_duplicate_reference boolean default false,
  p_due_ids uuid[] default null
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
    p_idempotency_key, p_backdate_reason, p_allow_duplicate_reference, null, p_due_ids);
end $$;
grant execute on function public.record_payment(uuid, bigint, date, text, text, text, text, text, uuid, text, boolean, uuid[]) to authenticated;

-- What a payment would cover, plus every open due (the list the month picker shows).
drop function if exists public.preview_allocation(uuid, bigint, uuid);
create or replace function public.preview_allocation(
  p_unit_id uuid, p_amount_paise bigint, p_fund_id uuid default null, p_due_ids uuid[] default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_society uuid;
  v_fund uuid;
  v_rem bigint := greatest(coalesce(p_amount_paise, 0), 0);
  v_choice uuid[] := coalesce(p_due_ids, '{}'::uuid[]);
  v_out jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_applied bigint := 0;
  v_adjusted bigint := 0;
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
    select x.id, x.amount_paise, public.due_paid_paise(x.id) as paid, public.due_label(x.id) as label,
           x.due_date, x.due_type, x.period, (x.id = any(v_choice)) as chosen
      from dues x
     where x.unit_id = p_unit_id and x.fund_id = v_fund and not x.waived
       and x.amount_paise > public.due_paid_paise(x.id)
     order by (x.id = any(v_choice)) desc, x.due_date, x.created_at, x.id
  loop
    v_amt := least(v_rem, d.amount_paise - d.paid);
    v_total := v_total + (d.amount_paise - d.paid);
    v_pending := v_pending || jsonb_build_object(
      'due_id', d.id, 'label', d.label, 'due_type', d.due_type, 'period', d.period, 'due_date', d.due_date,
      'due_paise', d.amount_paise, 'already_paid_paise', d.paid, 'remaining_paise', d.amount_paise - d.paid,
      'applying_paise', v_amt, 'chosen', d.chosen);
    if v_amt > 0 then
      v_out := v_out || jsonb_build_object('due_id', d.id, 'label', d.label, 'due_paise', d.amount_paise,
                                           'already_paid_paise', d.paid, 'amount_paise', v_amt, 'due_date', d.due_date);
      if cardinality(v_choice) > 0 and not d.chosen then v_adjusted := v_adjusted + v_amt; end if;
      v_applied := v_applied + v_amt;
      v_rem := v_rem - v_amt;
    end if;
  end loop;
  return jsonb_build_object('allocations', v_out, 'advance_paise', v_rem,
                            'existing_advance_paise', public.unit_advance_paise(p_unit_id, v_fund),
                            'pending', v_pending, 'pending_total_paise', v_total,
                            'pending_after_paise', v_total - v_applied, 'adjusted_paise', v_adjusted);
end $$;
grant execute on function public.preview_allocation(uuid, bigint, uuid, uuid[]) to authenticated;

drop function if exists public.submit_payment_claim(uuid, bigint, date, text, text, text, text, uuid);
create or replace function public.submit_payment_claim(
  p_society uuid,
  p_amount_paise bigint,
  p_paid_on date,
  p_payment_mode text,
  p_reference_no text,
  p_screenshot_path text default null,
  p_note text default null,
  p_fund_id uuid default null,
  p_due_ids uuid[] default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_unit uuid;
  v_fund record;
  v_mode text;
  v_ref text;
  v_id uuid;
  v_code text;
  v_due_ids uuid[] := nullif(p_due_ids, '{}'::uuid[]);
  v_labels text;
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
  perform public._check_due_choice(v_unit, v_fund.id, v_due_ids);
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
                              reference_no, screenshot_path, note, due_ids)
  values (p_society, v_unit, v_fund.id, auth.uid(), p_amount_paise, p_paid_on, v_mode, v_ref, p_screenshot_path,
          left(public.clean_text(p_note), 500), v_due_ids)
  returning id into v_id;

  select code into v_code from units where id = v_unit;
  if v_due_ids is not null then
    select string_agg(public.due_label(x), ', ') into v_labels from unnest(v_due_ids) x;
  end if;
  perform public._notify(p_society, public._perm_user_ids(p_society, 'approve_claims'), 'claim_submitted', v_id,
    format('Payment claim: %s paid %s', v_code, public.fmt_inr(p_amount_paise)),
    case when v_labels is not null then 'For ' || v_labels || '. ' else '' end || 'Verify in the bank / UPI app and approve.',
    '/admin/claims');
  return v_id;
end $$;
grant execute on function public.submit_payment_claim(uuid, bigint, date, text, text, text, text, uuid, uuid[]) to authenticated;

create or replace function public.approve_claim(
  p_claim_id uuid,
  p_amount_paise bigint default null,
  p_fund_id uuid default null,
  p_entry_date date default null,
  p_note text default null,
  p_allow_duplicate_reference boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record; v_result jsonb; v_date date; v_fund uuid; v_due_ids uuid[];
begin
  select * into c from payment_claims where id = p_claim_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Claim not found.'; end if;
  perform public.assert_perm(c.society_id, 'approve_claims');
  if c.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'This claim was already reviewed.';
  end if;
  v_date := coalesce(p_entry_date, c.paid_on);
  v_fund := coalesce(p_fund_id, c.fund_id);
  -- months the member named that are still open (one may have been paid since)
  select array_agg(d.id) into v_due_ids from dues d
   where d.id = any(coalesce(c.due_ids, '{}'::uuid[])) and d.unit_id = c.unit_id and d.fund_id = v_fund
     and not d.waived and public.due_remaining_paise(d.id) > 0;
  v_result := public._post_unit_payment(
    c.society_id, c.unit_id, v_fund, coalesce(p_amount_paise, c.amount_paise), v_date,
    c.payment_mode, c.reference_no, coalesce(public.clean_text(p_note), c.note), c.screenshot_path,
    'claim:' || c.id::text,
    'Payment claim submitted ' || to_char(c.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
    p_allow_duplicate_reference, c.id, v_due_ids);
  update payment_claims set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         ledger_entry_id = (v_result ->> 'entry_id')::uuid
   where id = c.id;
  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- Surplus board: who paid in advance (visible to every member)
-- ---------------------------------------------------------------------------
create or replace function public.surplus_board(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_general uuid;
begin
  perform public.assert_member(p_society);
  v_general := public.general_fund_id(p_society);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'advance_paise')::bigint + (x ->> 'event_advance_paise')::bigint desc, x ->> 'unit_code')
      from (
        select jsonb_build_object('unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
                                  'advance_paise', a.g, 'event_advance_paise', a.e) as x
          from units u
          cross join lateral (select public.unit_advance_paise(u.id, v_general) as g,
                                     (select coalesce(sum(public.unit_advance_paise(u.id, f.id)), 0)::bigint
                                        from funds f where f.society_id = p_society and f.kind = 'event') as e) a
         where u.society_id = p_society and (a.g > 0 or a.e > 0)
      ) t), '[]'::jsonb);
end $$;
grant execute on function public.surplus_board(uuid) to authenticated;

-- Society-wide overdue total (a number only — no flat is named)
create or replace function public.society_owed_total(p_society uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((select sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0))::bigint
                     from dues d where d.society_id = p_society and not d.waived and d.due_date < public.ist_today()), 0);
end $$;
grant execute on function public.society_owed_total(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privacy: who owes what is visible only to that flat and to admins
-- ---------------------------------------------------------------------------
drop policy if exists member_read on public.dues;
create policy dues_read on public.dues for select to authenticated using (
  public.is_admin(society_id) or unit_id in (select public.my_unit_ids(society_id))
);
drop policy if exists member_read on public.due_allocations;
create policy alloc_read on public.due_allocations for select to authenticated using (
  public.is_admin(society_id)
  or exists (select 1 from public.dues d where d.id = due_allocations.due_id
              and d.unit_id in (select public.my_unit_ids(d.society_id)))
);

-- defaulters: members only see their own flat
alter function public.defaulters(uuid) rename to _defaulters;
revoke execute on function public._defaulters(uuid) from public, anon, authenticated;
create or replace function public.defaulters(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if public.is_admin(p_society) then
    return public._defaulters(p_society);
  end if;
  return coalesce((select jsonb_agg(x) from jsonb_array_elements(public._defaulters(p_society)) x
                    where (x ->> 'unit_id')::uuid in (select public.my_unit_ids(p_society))), '[]'::jsonb);
end $$;
grant execute on function public.defaulters(uuid) to authenticated;

-- unit_statement: own flat or admin
alter function public.unit_statement(uuid) rename to _unit_statement;
revoke execute on function public._unit_statement(uuid) from public, anon, authenticated;
create or replace function public.unit_statement(p_unit_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Flat not found.'; end if;
  perform public.assert_member(v_society);
  if not (public.is_admin(v_society) or p_unit_id in (select public.my_unit_ids(v_society))) then
    raise exception using errcode = '42501', message = 'You can only see the statement of your own flat.';
  end if;
  return public._unit_statement(p_unit_id);
end $$;
grant execute on function public.unit_statement(uuid) to authenticated;

-- month_report: other flats' pending / part-paid rows are hidden from members
create or replace function public.month_report(p_society uuid, p_period text, p_fund_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_member(p_society);
  if p_fund_id is not null and not exists (select 1 from funds where id = p_fund_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  v := public._month_report(p_society, p_period, p_fund_id);
  if public.is_admin(p_society) then return v; end if;
  return jsonb_set(v, '{units}', coalesce((
    select jsonb_agg(x) from jsonb_array_elements(v -> 'units') x
     where (x ->> 'status') not in ('pending', 'partial')
        or (x ->> 'unit_id')::uuid in (select public.my_unit_ids(p_society))), '[]'::jsonb));
end $$;

-- event_report: same masking
alter function public.event_report(uuid) rename to _event_report;
revoke execute on function public._event_report(uuid) from public, anon, authenticated;
create or replace function public.event_report(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_society uuid;
begin
  select society_id into v_society from events where id = p_event_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_member(v_society);
  v := public._event_report(p_event_id);
  if public.is_admin(v_society) then return v; end if;
  return jsonb_set(v, '{units}', coalesce((
    select jsonb_agg(x) from jsonb_array_elements(v -> 'units') x
     where (x ->> 'status') not in ('pending', 'partial')
        or (x ->> 'unit_id')::uuid in (select public.my_unit_ids(v_society))), '[]'::jsonb));
end $$;
grant execute on function public.event_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Statements (date range). Rows are returned oldest first; the app adds the running balance.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_statement(p_society uuid, p_from date, p_to date, p_fund_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date := p_from; v_to date := coalesce(p_to, public.ist_today()); v_open bigint; v_rows jsonb; v_count int;
begin
  perform public.assert_member(p_society);
  if p_fund_id is not null and not exists (select 1 from funds where id = p_fund_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  if v_from is null then
    select min(entry_date) into v_from from ledger_entries where society_id = p_society and (p_fund_id is null or fund_id = p_fund_id);
    v_from := coalesce(v_from, v_to);
  end if;
  if v_from > v_to then raise exception using errcode = 'P0001', message = 'The start date must be on or before the end date.'; end if;
  if v_to > public.ist_today() then raise exception using errcode = 'P0001', message = 'The end date cannot be in the future.'; end if;
  select count(*) into v_count from ledger_entries
   where society_id = p_society and entry_date between v_from and v_to and (p_fund_id is null or fund_id = p_fund_id);
  if v_count > 20000 then
    raise exception using errcode = 'P0001', message = 'That range has more than 20,000 entries. Please choose a shorter range.';
  end if;
  select coalesce(sum(case when direction = 'credit' then amount_paise else -amount_paise end), 0)::bigint into v_open
    from ledger_entries where society_id = p_society and entry_date < v_from and (p_fund_id is null or fund_id = p_fund_id);
  select coalesce(jsonb_agg(jsonb_build_object(
           'entry_id', e.id, 'date', e.entry_date, 'direction', e.direction, 'amount_paise', e.amount_paise,
           'fund', f.name, 'category', e.category, 'unit_code', u.code, 'payee', e.payee, 'mode', e.payment_mode,
           'reference_no', e.reference_no, 'receipt_no', e.receipt_no, 'note', e.note,
           'is_reversed', public.is_entry_reversed(e.id), 'is_reversal', e.reverses_entry_id is not null)
         order by e.entry_date, e.created_at, e.id), '[]'::jsonb)
    into v_rows
    from ledger_entries e join funds f on f.id = e.fund_id left join units u on u.id = e.unit_id
   where e.society_id = p_society and e.entry_date between v_from and v_to and (p_fund_id is null or e.fund_id = p_fund_id);
  return jsonb_build_object('from', v_from, 'to', v_to, 'opening_paise', v_open, 'rows', v_rows,
    'fund', (select name from funds where id = p_fund_id), 'society', (select name from societies where id = p_society));
end $$;
grant execute on function public.ledger_statement(uuid, date, date, uuid) to authenticated;

-- Flat statement: charges (debit) against payments/waivers (credit). Positive balance = owed.
create or replace function public.unit_ledger_statement(p_unit_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_society uuid; v_unit record; v_from date := p_from; v_to date := coalesce(p_to, public.ist_today());
  v_open bigint; v_rows jsonb;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Flat not found.'; end if;
  perform public.assert_member(v_society);
  if not (public.is_admin(v_society) or p_unit_id in (select public.my_unit_ids(v_society))) then
    raise exception using errcode = '42501', message = 'You can only see the statement of your own flat.';
  end if;
  select u.code, u.display_name into v_unit from units u where u.id = p_unit_id;
  with l as (
    select d.due_date as d, d.created_at as ts, 'due' as kind, public.due_label(d.id) || ' due' as descr, null::text as ref,
           d.amount_paise as debit, 0::bigint as credit, d.id::text as id
      from dues d where d.unit_id = p_unit_id
    union all
    select coalesce(d.waived_at::date, d.due_date), coalesce(d.waived_at, d.created_at), 'waiver',
           public.due_label(d.id) || ' waived' || coalesce(' — ' || d.waived_reason, ''), null::text, 0::bigint,
           greatest(d.amount_paise - public.due_paid_paise(d.id), 0)::bigint, d.id::text || 'w'
      from dues d where d.unit_id = p_unit_id and d.waived and d.amount_paise > public.due_paid_paise(d.id)
    union all
    select e.entry_date, e.created_at,
           case when e.reverses_entry_id is null then 'payment' else 'reversal' end,
           case when e.reverses_entry_id is null
                then 'Payment received (' || coalesce(e.payment_mode, '') || ') ' ||
                     coalesce((select 'for ' || string_agg(public.due_label(a.due_id), ', ') from due_allocations a where a.ledger_entry_id = e.id), '')
                else 'Payment cancelled — ' || coalesce(e.note, '') end,
           coalesce(e.receipt_no, e.reference_no),
           case when e.direction = 'debit' then e.amount_paise else 0::bigint end,
           case when e.direction = 'credit' then e.amount_paise else 0::bigint end, e.id::text
      from ledger_entries e
     where e.unit_id = p_unit_id and e.category in ('maintenance', 'event_contribution')
  ), b as (select coalesce(p_from, (select min(l.d) from l), v_to) as f)
  select b.f,
         coalesce((select sum(l.debit - l.credit) from l where l.d < b.f), 0)::bigint,
         coalesce((select jsonb_agg(jsonb_build_object('date', l.d, 'kind', l.kind, 'description', l.descr, 'reference', l.ref,
                                                       'debit_paise', l.debit, 'credit_paise', l.credit) order by l.d, l.ts, l.id)
                     from l where l.d between b.f and v_to), '[]'::jsonb)
    into v_from, v_open, v_rows from b;
  if v_from > v_to then raise exception using errcode = 'P0001', message = 'The start date must be on or before the end date.'; end if;
  if v_to > public.ist_today() then raise exception using errcode = 'P0001', message = 'The end date cannot be in the future.'; end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'opening_paise', v_open, 'rows', v_rows,
    'unit', jsonb_build_object('code', v_unit.code, 'display_name', v_unit.display_name),
    'society', (select name from societies where id = v_society));
end $$;
grant execute on function public.unit_ledger_statement(uuid, date, date) to authenticated;

-- Every download is written to the audit log
create or replace function public.log_statement_export(p_society uuid, p_kind text, p_unit uuid, p_from date, p_to date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if p_kind not in ('ledger', 'flat') then raise exception using errcode = 'P0001', message = 'Invalid statement type.'; end if;
  if p_unit is not null and not (public.is_admin(p_society) or p_unit in (select public.my_unit_ids(p_society))) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  perform public.audit_append(p_society, 'STATEMENT_EXPORT', case when p_kind = 'flat' then 'units' else 'ledger_entries' end,
    p_unit::text, null, jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'by', auth.uid()));
end $$;
grant execute on function public.log_statement_export(uuid, text, uuid, date, date) to authenticated;
