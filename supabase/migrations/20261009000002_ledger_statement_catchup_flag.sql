-- Mark ledger-statement rows that settle an OLDER due than the month they were paid in
-- (e.g. paid in October for August's security guard event — a catch-up payment),
-- so the app can show them in a distinct colour. Purely additive: existing fields,
-- filtering and totals are unchanged.

create or replace function public._entry_for_label(p_entry_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(distinct public.due_label(a.due_id), ', ' order by public.due_label(a.due_id))
    from due_allocations a where a.ledger_entry_id = p_entry_id
$$;
revoke execute on function public._entry_for_label(uuid) from public, anon, authenticated;

create or replace function public._entry_is_catchup(p_entry_id uuid, p_entry_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(bool_or(public.period_of(d.due_date) < public.period_of(p_entry_date)), false)
    from due_allocations a join dues d on d.id = a.due_id where a.ledger_entry_id = p_entry_id
$$;
revoke execute on function public._entry_is_catchup(uuid, date) from public, anon, authenticated;

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
           'is_reversed', public.is_entry_reversed(e.id), 'is_reversal', e.reverses_entry_id is not null,
           'is_catchup', e.direction = 'credit' and public._entry_is_catchup(e.id, e.entry_date),
           'for_label', case when e.direction = 'credit' then public._entry_for_label(e.id) end)
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
           d.amount_paise as debit, 0::bigint as credit, d.id::text as id, false as is_catchup, null::text as for_label
      from dues d where d.unit_id = p_unit_id
    union all
    select coalesce(d.waived_at::date, d.due_date), coalesce(d.waived_at, d.created_at), 'waiver',
           public.due_label(d.id) || ' waived' || coalesce(' — ' || d.waived_reason, ''), null::text, 0::bigint,
           greatest(d.amount_paise - public.due_paid_paise(d.id), 0)::bigint, d.id::text || 'w', false, null::text
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
           case when e.direction = 'credit' then e.amount_paise else 0::bigint end, e.id::text,
           e.reverses_entry_id is null and public._entry_is_catchup(e.id, e.entry_date),
           case when e.reverses_entry_id is null then public._entry_for_label(e.id) end
      from ledger_entries e
     where e.unit_id = p_unit_id and e.category in ('maintenance', 'event_contribution')
  ), b as (select coalesce(p_from, (select min(l.d) from l), v_to) as f)
  select b.f,
         coalesce((select sum(l.debit - l.credit) from l where l.d < b.f), 0)::bigint,
         coalesce((select jsonb_agg(jsonb_build_object('date', l.d, 'kind', l.kind, 'description', l.descr, 'reference', l.ref,
                                                       'debit_paise', l.debit, 'credit_paise', l.credit,
                                                       'is_catchup', l.is_catchup, 'for_label', l.for_label) order by l.d, l.ts, l.id)
                     from l where l.d between b.f and v_to), '[]'::jsonb)
    into v_from, v_open, v_rows from b;
  if v_from > v_to then raise exception using errcode = 'P0001', message = 'The start date must be on or before the end date.'; end if;
  if v_to > public.ist_today() then raise exception using errcode = 'P0001', message = 'The end date cannot be in the future.'; end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'opening_paise', v_open, 'rows', v_rows,
    'unit', jsonb_build_object('code', v_unit.code, 'display_name', v_unit.display_name),
    'society', (select name from societies where id = v_society));
end $$;
grant execute on function public.unit_ledger_statement(uuid, date, date) to authenticated;
