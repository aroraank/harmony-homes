-- Harmony Homes — "forgot my PIN" requests and a society-wide position (balance / pending / advance) for everyone.

-- ---------------------------------------------------------------------------
-- 1. PIN reset requests (a member who cannot sign in asks the admins to set a new PIN)
-- ---------------------------------------------------------------------------
create table if not exists public.pin_reset_requests (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index if not exists pin_reset_requests_open_idx on public.pin_reset_requests(society_id, user_id) where resolved_at is null;

alter table public.pin_reset_requests enable row level security;
create policy pinreq_read on public.pin_reset_requests for select to authenticated using (public.is_admin(society_id));
revoke all on public.pin_reset_requests from anon;
grant select on public.pin_reset_requests to authenticated;

create trigger audit_pin_reset_requests after insert or update or delete on public.pin_reset_requests
  for each row execute function public.audit_trigger();
create trigger zz_view_only_guard before insert or update or delete on public.pin_reset_requests
  for each statement execute function public.block_view_only_writes();

-- Public endpoint used by the sign-in screen. It always answers the same way, so it cannot be used to find out
-- which flat codes exist; one open request per person per hour; at most 40 requests per society per hour.
create or replace function public.request_pin_reset(p_slug text, p_username text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_slug text := lower(public.clean_text(p_slug));
  v_user text := lower(public.clean_text(p_username));
  v_society uuid;
  v_uid uuid;
  v_label text;
begin
  if v_slug is null or v_user is null or char_length(v_user) > 40 or char_length(v_slug) > 41 then
    return jsonb_build_object('ok', true);
  end if;
  select id into v_society from societies where slug = v_slug;
  if v_society is null then return jsonb_build_object('ok', true); end if;
  select u.id into v_uid from auth.users u where u.email = v_user || '@' || v_slug || '.local';
  if v_uid is null or not exists (select 1 from memberships where user_id = v_uid and society_id = v_society and status = 'active') then
    return jsonb_build_object('ok', true);
  end if;
  if exists (select 1 from pin_reset_requests where user_id = v_uid and society_id = v_society
              and (resolved_at is null or created_at > now() - interval '1 hour') and created_at > now() - interval '1 hour')
     or (select count(*) from pin_reset_requests where society_id = v_society and created_at > now() - interval '1 hour') >= 40 then
    return jsonb_build_object('ok', true);
  end if;
  insert into pin_reset_requests (society_id, user_id) values (v_society, v_uid);
  select coalesce(un.code, p.full_name) into v_label
    from memberships m join profiles p on p.id = m.user_id left join units un on un.id = m.unit_id
   where m.user_id = v_uid and m.society_id = v_society and m.status = 'active' limit 1;
  perform public._notify(v_society, public._admin_ids(v_society), 'pin_reset_request', v_uid,
    format('%s forgot the PIN', v_label),
    'Set a new PIN in Members & logins → Reset PIN, then give it to them personally.',
    '/admin/members');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.request_pin_reset(text, text) to anon, authenticated;

-- A reset by an admin closes the member's open requests
create or replace function public._after_password_reset(p_actor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._act_as(p_actor);
  update profiles set must_change_password = true, updated_at = now() where id = p_user;
  update pin_reset_requests set resolved_at = now(), resolved_by = p_actor where user_id = p_user and resolved_at is null;
  perform public._revoke_sessions(p_user, null);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Society position — visible to every member, read-only
-- ---------------------------------------------------------------------------
create or replace function public.society_position(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_funds jsonb;
begin
  perform public.assert_member(p_society);
  select coalesce(jsonb_agg(x order by (x ->> 'sort')::int, x ->> 'name'), '[]'::jsonb) into v_funds from (
    select jsonb_build_object(
      'id', f.id, 'name', f.name, 'kind', f.kind, 'event_id', f.event_id,
      'sort', case when f.kind = 'general' then 0 else 1 end,
      'balance_paise', public.fund_balance_paise(f.id),
      'pending_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.fund_id = f.id and not d.waived),
      'overdue_paise', (select coalesce(sum(greatest(d.amount_paise - public.due_paid_paise(d.id), 0)), 0)
                          from dues d where d.fund_id = f.id and not d.waived and d.due_date < public.ist_today()),
      'advance_paise', (select coalesce(sum(public.entry_unallocated_paise(e.id)), 0)
                          from ledger_entries e
                         where e.fund_id = f.id and e.direction = 'credit' and e.unit_id is not null
                           and e.category in ('maintenance', 'event_contribution') and e.reverses_entry_id is null)
    ) as x
    from funds f
   where f.society_id = p_society
     and (f.kind = 'general' or exists (select 1 from events e where e.fund_id = f.id and e.status = 'open')
          or public.fund_balance_paise(f.id) <> 0
          or exists (select 1 from dues d where d.fund_id = f.id and not d.waived and d.amount_paise > public.due_paid_paise(d.id)))
  ) t;
  return jsonb_build_object(
    'funds', v_funds,
    'totals', jsonb_build_object(
      'balance_paise', public.society_balance_paise(p_society),
      'pending_paise', (select coalesce(sum((x ->> 'pending_paise')::bigint), 0) from jsonb_array_elements(v_funds) x),
      'overdue_paise', (select coalesce(sum((x ->> 'overdue_paise')::bigint), 0) from jsonb_array_elements(v_funds) x),
      'advance_paise', (select coalesce(sum((x ->> 'advance_paise')::bigint), 0) from jsonb_array_elements(v_funds) x)));
end $$;
grant execute on function public.society_position(uuid) to authenticated;
