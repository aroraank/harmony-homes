-- Pending list: each overdue item now carries its own amount (label, pending, due date).
create or replace function public.defaulters(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_member(p_society);
  v := public._defaulters(p_society);
  if not public.is_admin(p_society) then
    v := coalesce((select jsonb_agg(x) from jsonb_array_elements(v) x
                    where (x ->> 'unit_id')::uuid in (select public.my_unit_ids(p_society))), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(x || jsonb_build_object('items', coalesce((
      select jsonb_agg(jsonb_build_object('label', public.due_label(d.id),
                                          'pending_paise', d.amount_paise - public.due_paid_paise(d.id),
                                          'due_date', d.due_date) order by d.due_date)
        from dues d
       where d.unit_id = (x ->> 'unit_id')::uuid and not d.waived and d.due_date < public.ist_today()
         and d.amount_paise > public.due_paid_paise(d.id)), '[]'::jsonb))
                     order by (x ->> 'pending_paise')::bigint desc, x ->> 'unit_code')
    from jsonb_array_elements(v) x), '[]'::jsonb);
end $$;
grant execute on function public.defaulters(uuid) to authenticated;
