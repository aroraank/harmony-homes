-- Surplus view:
--  * funds of months before settings.balance_from_period (default Sep 2026) are treated as opening ₹0: past collections for
--    those months were never tracked against spending, so they must not show as a balance;
--  * events for one flat type (2BHK / 3BHK) or selected flats are only listed to members of those flats (admins see all)
--    and are reported as separate surplus groups, never inside the overall figures.
alter table public.society_settings add column if not exists balance_from_period text not null default '2026-09'
  check (public.is_valid_period(balance_from_period));

create or replace function public.society_position(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_funds jsonb;
begin
  perform public.assert_member(p_society);
  select coalesce(jsonb_agg(x order by (x ->> 'sort')::int, x ->> 'ord' desc, x ->> 'name'), '[]'::jsonb) into v_funds from (
    select jsonb_build_object(
      'id', f.id, 'name', f.name, 'kind', f.kind, 'event_id', f.event_id,
      'sort', case when f.kind = 'general' then 0 else 1 end,
      'ord', coalesce(ev.series_period, to_char(ev.created_at at time zone 'Asia/Kolkata', 'YYYY-MM')),
      'scope_label', case when ev.id is null or ev.scope_type = 'all' then null
                          when ev.scope_type = 'unit_types' then (select string_agg(ut.name, ' + ' order by ut.name) from unit_types ut where ut.id = any(ev.scope_unit_type_ids))
                          else 'Selected flats' end,
      'counted', (f.kind = 'general' or coalesce(ev.series_period, to_char(ev.created_at at time zone 'Asia/Kolkata', 'YYYY-MM')) >= st.balance_from_period),
      'balance_paise', case when f.kind = 'general' or coalesce(ev.series_period, to_char(ev.created_at at time zone 'Asia/Kolkata', 'YYYY-MM')) >= st.balance_from_period
                            then public.fund_balance_paise(f.id) else 0 end,
      'earlier_balance_paise', case when f.kind = 'general' or coalesce(ev.series_period, to_char(ev.created_at at time zone 'Asia/Kolkata', 'YYYY-MM')) >= st.balance_from_period
                            then 0 else public.fund_balance_paise(f.id) end,
      'pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.fund_id = f.id and not d.waived),
      'overdue_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.fund_id = f.id and not d.waived and d.due_date < public.ist_today()),
      'advance_paise', (select coalesce(sum(public.entry_unallocated_paise(e.id)), 0)
                          from ledger_entries e
                         where e.fund_id = f.id and e.direction = 'credit' and e.unit_id is not null
                           and e.category in ('maintenance', 'event_contribution') and e.reverses_entry_id is null)
    ) as x
    from funds f left join events ev on ev.id = f.event_id
    join society_settings st on st.society_id = f.society_id
   where f.society_id = p_society
     and (public.is_admin(p_society) or ev.id is null or ev.scope_type = 'all'
          or exists (select 1 from event_units eu where eu.event_id = ev.id and eu.unit_id in (select public.my_unit_ids(p_society))))
     and (f.kind = 'general' or ev.status = 'open'
          or public.fund_balance_paise(f.id) <> 0
          or exists (select 1 from dues d where d.fund_id = f.id and not d.waived and d.amount_paise > public.due_paid_paise(d.id)))
  ) t;
  return jsonb_build_object(
    'funds', v_funds,
    -- overall = General + events that apply to every flat; flat-type-only events are reported separately
    'totals', jsonb_build_object(
      'balance_paise', (select coalesce(sum((x ->> 'balance_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'pending_paise', (select coalesce(sum((x ->> 'pending_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'overdue_paise', (select coalesce(sum((x ->> 'overdue_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'advance_paise', (select coalesce(sum((x ->> 'advance_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null)),
    'scoped', coalesce((select jsonb_agg(jsonb_build_object('label', l,
        'balance_paise', b, 'pending_paise', p, 'advance_paise', a) order by l)
      from (select x ->> 'scope_label' as l, sum((x ->> 'balance_paise')::bigint) as b,
                   sum((x ->> 'pending_paise')::bigint) as p, sum((x ->> 'advance_paise')::bigint) as a
              from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is not null group by 1) g), '[]'::jsonb));
end $$;
grant execute on function public.society_position(uuid) to authenticated;
