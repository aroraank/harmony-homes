-- Harmony Homes — super admin "View as" another member/admin.
-- The super admin gets a short-lived sign-in as that person (magic-link / OTP session).
-- Members only ever sign in with a password, so an OTP session is recognisable from its
-- JWT `amr` claim and is made strictly READ-ONLY here, in the database, for every table
-- and for file uploads. Each "view as" is written to the audit log and raises an alert.

create or replace function public.is_view_only_session() returns boolean
language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'role') = 'authenticated', false)
     and exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
                  where a ->> 'method' in ('otp', 'magiclink'))
     and not exists (select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
                      where a ->> 'method' = 'password')
$$;
grant execute on function public.is_view_only_session() to authenticated;

create or replace function public.block_view_only_writes() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.is_view_only_session() then
    raise exception using errcode = '42501',
      message = 'View only: you are viewing as another member. Switch back to your own account to make changes.';
  end if;
  return null;
end $$;

-- attach to every table in public (statement level: one cheap check per write statement)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop trigger if exists zz_view_only_guard on public.%I', t);
    execute format('create trigger zz_view_only_guard before insert or update or delete on public.%I
                    for each statement execute function public.block_view_only_writes()', t);
  end loop;
end $$;

-- uploads (claims screenshots, concern files…) are refused too
create or replace function public.can_write_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_society uuid := public.try_uuid(v_parts[1]);
  v_kind text := v_parts[2];
  v_owner text := v_parts[3];
begin
  if public.is_view_only_session() then
    return false;
  end if;
  if v_society is null or array_length(v_parts, 1) < 3 or not public.is_member(v_society) then
    return false;
  end if;
  if v_kind = 'claims' then
    return v_owner = auth.uid()::text;
  elsif v_kind = 'concerns' then
    return v_owner = 'new-' || auth.uid()::text or public.can_view_concern(public.try_uuid(v_owner));
  elsif v_kind = 'ledger' then
    return public.has_perm(v_society, 'record_payment') or public.has_perm(v_society, 'record_expense')
        or public.has_perm(v_society, 'manage_reminders');
  elsif v_kind = 'notices' then
    return public.has_perm(v_society, 'send_notices');
  elsif v_kind = 'settings' then
    return public.has_perm(v_society, 'manage_settings');
  end if;
  return false;
end $$;

-- Called only by the admin-users Edge Function (service role) before it issues the sign-in.
-- Checks the rules, writes the audit row under the super admin's name and alerts super admins.
create or replace function public._start_view_as(p_actor uuid, p_society uuid, p_target_membership uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_actor_name text;
begin
  if public.user_role(p_actor, p_society) is distinct from 'super_admin' then
    raise exception using errcode = '42501', message = 'Only the super admin can view as another member.';
  end if;
  select m.id, m.user_id, m.role, m.status, m.unit_id, u.code as unit_code, p.full_name
    into t
    from memberships m join profiles p on p.id = m.user_id left join units u on u.id = m.unit_id
   where m.id = p_target_membership and m.society_id = p_society;
  if not found or t.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'Member not found or not active.';
  end if;
  if t.user_id = p_actor then
    raise exception using errcode = 'P0001', message = 'That is your own account.';
  end if;
  if t.role = 'super_admin' then
    raise exception using errcode = 'P0001', message = 'Another super admin cannot be viewed.';
  end if;
  select full_name into v_actor_name from profiles where id = p_actor;

  -- record the audit row as the super admin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform public.audit_append(p_society, 'VIEW_AS', 'memberships', t.id::text, null,
    jsonb_build_object('viewer', p_actor, 'viewer_name', v_actor_name, 'viewed_user', t.user_id,
                       'viewed_name', t.full_name, 'viewed_unit', t.unit_code, 'viewed_role', t.role));
  insert into alerts (society_id, kind, title, details)
  values (p_society, 'view_as',
          format('%s viewed the app as %s', coalesce(v_actor_name, 'Super admin'), coalesce(t.unit_code, t.full_name)),
          jsonb_build_object('viewer', p_actor, 'viewed_user', t.user_id, 'viewed_role', t.role));
  return jsonb_build_object('user_id', t.user_id, 'label', coalesce(t.unit_code || ' · ', '') || t.full_name, 'role', t.role);
end $$;
revoke execute on function public._start_view_as(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._start_view_as(uuid, uuid, uuid) to service_role;
