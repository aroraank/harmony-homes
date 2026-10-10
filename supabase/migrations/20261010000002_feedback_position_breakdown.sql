-- 1. Fix: members could not read their own pending-payment acknowledgements (table had RLS but no SELECT grant),
--    so the pending-payment reminder popup never appeared.
grant select on public.payment_acks to authenticated;

-- 2. App feedback: any member can send (rating + mandatory comment); only the super admin can read.
create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_id uuid references public.units(id),
  rating text not null check (rating in ('best', 'good', 'bad')),
  comment text not null check (char_length(comment) between 5 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists app_feedback_society_idx on public.app_feedback(society_id, created_at desc);
alter table public.app_feedback enable row level security;
-- no table grants: reads and writes only through the two functions below

create or replace function public.submit_app_feedback(p_society uuid, p_rating text, p_comment text) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare v_id uuid; v_unit uuid; v_comment text := public.clean_text(p_comment); v_code text;
begin
  perform public.assert_member(p_society);
  if p_rating is null or p_rating not in ('best', 'good', 'bad') then
    raise exception using errcode = 'P0001', message = 'Please choose Best, Good or Bad.';
  end if;
  if char_length(coalesce(v_comment, '')) < 5 then
    raise exception using errcode = 'P0001', message = 'Please write your comment (at least 5 characters).';
  end if;
  if char_length(v_comment) > 1000 then
    raise exception using errcode = 'P0001', message = 'Please keep the comment under 1000 characters.';
  end if;
  if (select count(*) from app_feedback where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception using errcode = 'P0001', message = 'Thank you! You have sent a lot of feedback today. Please try again tomorrow.';
  end if;
  select unit_id into v_unit from memberships
   where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null limit 1;
  insert into app_feedback (society_id, user_id, unit_id, rating, comment)
  values (p_society, auth.uid(), v_unit, p_rating, v_comment) returning id into v_id;
  select code into v_code from units where id = v_unit;
  perform public._notify(p_society, public._super_admin_ids(p_society), 'app_feedback', v_id,
    format('App feedback (%s) from %s', initcap(p_rating), coalesce(v_code, 'a member')),
    left(v_comment, 200), '/feedback');
  return v_id;
end $fn$;
grant execute on function public.submit_app_feedback(uuid, text, text) to authenticated;

create or replace function public.app_feedback_list(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public.assert_member(p_society);
  if not public.is_super_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only the super admin can read app feedback.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'rating', f.rating, 'comment', f.comment, 'created_at', f.created_at,
             'unit_code', u.code, 'name', p.full_name) order by f.created_at desc)
      from app_feedback f
      left join units u on u.id = f.unit_id
      left join profiles p on p.id = f.user_id
     where f.society_id = p_society), '[]'::jsonb);
end $fn$;
grant execute on function public.app_feedback_list(uuid) to authenticated;

-- 3. What makes up each fund's figures on the Society position page. Read-only.
--    Uses exactly the funds society_position() shows (same visibility rules) and the same arithmetic:
--    collected + other − spent = fund balance; pending = Σ unpaid part of each due.
--    Flat numbers in "yet to collect" are shown only to admins, or for the member's own flat.
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
                     'flat', case when v_admin or d.unit_id = any(v_mine) then u.code end,
                     'mine', d.unit_id = any(v_mine),
                     'amount_paise', d.amount_paise - public.due_paid_paise(d.id)) order by u.sort_order, u.code), '[]'::jsonb)
                    from dues d join units u on u.id = d.unit_id
                   where d.fund_id = f.id and not d.waived and d.amount_paise > public.due_paid_paise(d.id))))
      from funds f
     where f.id in (select (x ->> 'id')::uuid from jsonb_array_elements(v_pos -> 'funds') x)), '[]'::jsonb);
end $fn$;
grant execute on function public.society_position_breakdown(uuid) to authenticated;
