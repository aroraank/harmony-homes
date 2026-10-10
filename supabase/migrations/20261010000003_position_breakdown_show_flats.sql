-- Society position slips: show every flat that still has to pay (flat number + amount), to all members.
-- Read-only function change. To hide other flats from members again, re-run 20261010000002.

create or replace function public.society_position_breakdown(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare v_pos jsonb; v_admin boolean; v_mine uuid[];
begin
  v_pos := public.society_position(p_society);   -- checks membership and visibility
  v_admin := public.is_admin(p_society);
  select coalesce(array_agg(x), '{}') into v_mine from public.my_unit_ids(p_society) x;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'fund_id', f.id,
      'collected_paise', (select coalesce(sum(case when e.direction = 'credit' then e.amount_paise else -e.amount_paise end), 0)
                            from ledger_entries e where e.fund_id = f.id and e.category in ('maintenance', 'event_contribution')),
      'payments_count', (select count(*) from ledger_entries e
                          where e.fund_id = f.id and e.direction = 'credit' and e.category in ('maintenance', 'event_contribution')
                            and e.reverses_entry_id is null and not public.is_entry_reversed(e.id)),
      'spent_paise', (select coalesce(sum(case when e.direction = 'debit' then e.amount_paise else -e.amount_paise end), 0)
                        from ledger_entries e where e.fund_id = f.id
                         and e.category not in ('maintenance', 'event_contribution', 'transfer', 'opening_balance', 'adjustment')),
      'other_paise', (select coalesce(sum(case when e.direction = 'credit' then e.amount_paise else -e.amount_paise end), 0)
                        from ledger_entries e where e.fund_id = f.id and e.category in ('transfer', 'opening_balance', 'adjustment')),
      'expenses', (select coalesce(jsonb_agg(jsonb_build_object('date', e.entry_date,
                                     'label', coalesce(e.payee, initcap(replace(e.category, '_', ' '))),
                                     'amount_paise', e.amount_paise) order by e.entry_date, e.created_at), '[]'::jsonb)
                     from ledger_entries e
                    where e.fund_id = f.id and e.direction = 'debit' and e.reverses_entry_id is null
                      and not public.is_entry_reversed(e.id)
                      and e.category not in ('maintenance', 'event_contribution', 'transfer', 'opening_balance', 'adjustment')),
      'pending', (select coalesce(jsonb_agg(jsonb_build_object(
                     'flat', u.code,
                     'mine', d.unit_id = any(v_mine),
                     'amount_paise', d.amount_paise - public.due_paid_paise(d.id)) order by u.sort_order, u.code), '[]'::jsonb)
                    from dues d join units u on u.id = d.unit_id
                   where d.fund_id = f.id and not d.waived and d.amount_paise > public.due_paid_paise(d.id))))
      from funds f
     where f.id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_pos -> 'funds') x)), '[]'::jsonb);
end $fn$;
grant execute on function public.society_position_breakdown(uuid) to authenticated;
