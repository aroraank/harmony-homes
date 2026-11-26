-- 2026-11-26: pending ("not yet paid") flats are now shown to every member, not just admins.
-- Khera sahab's ask: all 11 unpaid flats' plot number + name should be visible to everyone, not just
-- who HAS paid (which already showed). We still never say *why* a flat is pending -- that was never
-- tracked -- and contact numbers stay out of this list entirely (they were never part of it): phone
-- numbers remain visible only to admins/super admins (Members page) and the security guard (gate
-- directory), unchanged by this migration. This replaces the previous version of defaulters() added in
-- 20261008000011_pending_list_items.sql, which restricted non-admins to seeing only their own flat.
-- Safe to run more than once.

create or replace function public.defaulters(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_member(p_society);
  v := public._defaulters(p_society);
  -- Everyone (not just admins) now sees the full society-wide list.
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
