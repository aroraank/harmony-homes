-- 2026-11-26: resident names.
--  * Every flat gets a login whose profile starts out named after the unit itself (e.g. "First Floor") --
--    never a real person's name -- until the resident sets their own. That's the long-standing gap: flats
--    show in lists, but nobody's actual name was ever forced in.
--  * profiles.name_set tracks whether a REAL name has been entered. Backfilled false only for profiles
--    whose full_name still literally matches their own unit's placeholder display_name (i.e. never
--    touched) and whose role is 'resident' -- admin/staff/super-admin profiles and anyone who already
--    typed a real name are left alone (true), same as the existing vehicle-prompt pattern that exempts
--    admins/super-admins from member-only popups.
--  * update_my_profile / admin_update_member_profile now mark name_set = true once a name is saved.
--  * admin_bulk_set_names(): the admin's "Excel/CSV list" (plot number, first + last name, phone) in one
--    call -- matches each row to its unit's active resident login and fills the name in, same as a member
--    doing it themselves (marks name_set = true too), with phone numbers that stay admin/guard-only as
--    always.
-- Safe to run more than once.

alter table public.profiles add column if not exists name_set boolean not null default true;

update public.profiles p
   set name_set = false
  from memberships m, units u
 where m.user_id = p.id and m.unit_id = u.id and m.role = 'resident' and m.status = 'active'
   and p.full_name = u.display_name;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_locale text) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.norm_phone(p_phone);
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> auth.uid()) then
    raise exception using errcode = 'P0001', message = 'This mobile number is already used by another account.';
  end if;
  update profiles set full_name = public.check_person_name(p_full_name), phone = v_phone, name_set = true,
         locale = case when p_locale in ('en', 'hi') then p_locale else locale end, updated_at = now()
   where id = auth.uid();
end $$;

create or replace function public.admin_update_member_profile(p_membership_id uuid, p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_phone text := public.norm_phone(p_phone);
begin
  select * into m from memberships where id = p_membership_id;
  if not found then raise exception using errcode = 'P0001', message = 'Member not found.'; end if;
  perform public.assert_perm(m.society_id, 'manage_users');
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> m.user_id) then
    raise exception using errcode = 'P0001', message = 'This mobile number is already used by another account.';
  end if;
  update profiles set full_name = public.check_person_name(p_full_name), phone = v_phone, name_set = true, updated_at = now()
   where id = m.user_id;
end $$;

create or replace function public.admin_bulk_set_names(p_society uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_code text; v_name text; v_phone text; v_user uuid;
        v_errors jsonb := '[]'::jsonb; v_count int := 0;
begin
  perform public.assert_perm(p_society, 'manage_users');
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = 'P0001', message = 'Rows must be a list.';
  end if;
  if jsonb_array_length(p_rows) > 300 then
    raise exception using errcode = 'P0001', message = 'Upload at most 300 rows at a time.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := upper(btrim(coalesce(r ->> 'unit_code', '')));
    v_user := null;
    begin
      select m.user_id into v_user
        from memberships m join units u on u.id = m.unit_id
       where u.society_id = p_society and u.code = v_code and m.status = 'active' and m.role = 'resident'
       limit 1;
      if v_user is null then
        v_errors := v_errors || jsonb_build_object('unit_code', v_code, 'error', 'No active resident login for this plot.');
        continue;
      end if;
      v_name := public.check_person_name(r ->> 'full_name');
      v_phone := public.norm_phone(r ->> 'phone');
      if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> v_user) then
        v_errors := v_errors || jsonb_build_object('unit_code', v_code, 'error', 'Mobile number already used by another account.');
        continue;
      end if;
      update profiles set full_name = v_name, phone = coalesce(v_phone, phone), name_set = true, updated_at = now()
       where id = v_user;
      v_count := v_count + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('unit_code', v_code, 'error', sqlerrm);
    end;
  end loop;
  perform public.audit_append(p_society, 'bulk_set_names', 'profiles', null, null,
    jsonb_build_object('updated', v_count, 'errors', v_errors));
  return jsonb_build_object('updated', v_count, 'errors', v_errors);
end $$;
revoke execute on function public.admin_bulk_set_names(uuid, jsonb) from public, anon;
grant execute on function public.admin_bulk_set_names(uuid, jsonb) to authenticated;
