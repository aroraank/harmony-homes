-- Flat statement: leave out cancelled payments and their cancellation entries.
-- They are always dated the same day and cancel out exactly, so opening, running and closing
-- balances are unchanged. Both rows stay in the ledger table for audit (rows are never deleted).
-- Read-only function change — no data is touched.

create or replace function public.unit_ledger_statement(p_unit_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
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
       -- a cancelled payment and its cancellation are always on the same date and cancel out exactly,
       -- so leaving both out keeps every balance identical and the statement clean
       and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)
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
end $fn$;
grant execute on function public.unit_ledger_statement(uuid, date, date) to authenticated;
