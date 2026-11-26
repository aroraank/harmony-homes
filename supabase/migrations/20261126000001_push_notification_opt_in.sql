-- 2026-11-26: push-notification opt-in status, visible to admins.
--  * profiles.push_opt_in: null = never decided, true = enabled on at least one device right now,
--    false = explicitly turned off. Set automatically by save_push_subscription / delete_push_subscription,
--    so no extra UI work was needed on the enable/disable buttons already in Profile and on Home.
--  * notification_opt_in_report: admin/super-admin only. One row per active member of the society —
--    name, flat, opt-in status, and how many devices currently have a live subscription.
-- Safe to run more than once.

alter table public.profiles add column if not exists push_opt_in boolean;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception using errcode = 'P0001', message = 'Invalid push subscription.';
  end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_label, 120))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    device_label = excluded.device_label, last_seen = now();
  update public.profiles set push_opt_in = true where id = auth.uid();
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  update public.profiles set push_opt_in = false where id = auth.uid();
end $$;

create or replace function public.notification_opt_in_report(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_res jsonb;
begin
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Admins only.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', x.user_id, 'name', x.full_name, 'unit_code', x.code, 'unit_name', x.display_name,
           'role', x.role, 'push_opt_in', x.push_opt_in, 'device_count', x.device_count
         ) order by x.code nulls last, x.full_name), '[]'::jsonb)
    into v_res
    from (
      select m.user_id, p.full_name, p.push_opt_in, m.role, u.code, u.display_name,
             (select count(*) from push_subscriptions s where s.user_id = m.user_id) as device_count
        from memberships m
        join profiles p on p.id = m.user_id
        left join units u on u.id = m.unit_id
       where m.society_id = p_society and m.status = 'active'
    ) x;
  return v_res;
end $$;
revoke execute on function public.notification_opt_in_report(uuid) from public, anon;
grant execute on function public.notification_opt_in_report(uuid) to authenticated;

-- Once a browser is blocked, no button can ever re-trigger the native permission prompt — that's a
-- platform rule, not something this app controls. The client detects the blocked state itself and
-- calls this so the admin report shows "Off" (a real decision) rather than "Not decided".
create or replace function public.set_push_opt_in(p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  update public.profiles set push_opt_in = p_value where id = auth.uid();
end $$;
revoke execute on function public.set_push_opt_in(boolean) from public, anon;
grant execute on function public.set_push_opt_in(boolean) to authenticated;

