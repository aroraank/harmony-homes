-- Harmony Homes — members, settings, units, notices, concerns, contacts, reminders, jobs

-- ---------------------------------------------------------------------------
-- Context for the signed-in user (works before the first password change)
-- ---------------------------------------------------------------------------
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_profile jsonb; v_memberships jsonb;
begin
  if v_uid is null then return null; end if;
  select to_jsonb(p) - 'avatar_path' into v_profile from profiles p where p.id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', m.id, 'society_id', s.id, 'society_name', s.name, 'society_slug', s.slug,
           'role', m.role, 'status', m.status, 'unit_id', m.unit_id, 'unit_code', u.code,
           'unit_name', u.display_name, 'unit_type_id', u.unit_type_id,
           'permissions', (select coalesce(jsonb_agg(p.perm), '[]'::jsonb) from unnest(public.permission_catalogue()) p(perm)
                            where public.user_has_perm(v_uid, s.id, p.perm) or (m.role = 'super_admin' and m.status = 'active'))
         ) order by s.name), '[]'::jsonb)
    into v_memberships
    from memberships m join societies s on s.id = m.society_id left join units u on u.id = m.unit_id
   where m.user_id = v_uid and m.status <> 'deactivated';
  return jsonb_build_object('user_id', v_uid, 'profile', v_profile, 'memberships', v_memberships);
end $$;

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------
create or replace function public.norm_phone(p_phone text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v = '' then return null; end if;
  if length(v) = 12 and left(v, 2) = '91' then v := substr(v, 3); end if;
  if length(v) = 11 and left(v, 1) = '0' then v := substr(v, 2); end if;
  if v !~ '^[6-9][0-9]{9}$' then
    raise exception using errcode = 'P0001', message = 'Enter a valid 10-digit Indian mobile number.';
  end if;
  return v;
end $$;

create or replace function public.check_person_name(p_name text) returns text
language plpgsql immutable set search_path = public as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if v ~ '\s{2,}' or v !~ '^[A-Za-z][A-Za-z .'']{1,59}$' or char_length(v) < 2 or char_length(v) > 60 then
    raise exception using errcode = 'P0001', message = 'Name must be 2–60 letters (spaces, dot and apostrophe allowed).';
  end if;
  return v;
end $$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_locale text) returns void
language plpgsql security definer set search_path = public as $$
declare v_phone text := public.norm_phone(p_phone);
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  if v_phone is not null and exists (select 1 from profiles where phone = v_phone and id <> auth.uid()) then
    raise exception using errcode = 'P0001', message = 'This mobile number is already used by another account.';
  end if;
  update profiles set full_name = public.check_person_name(p_full_name), phone = v_phone,
         locale = case when p_locale in ('en', 'hi') then p_locale else locale end, updated_at = now()
   where id = auth.uid();
end $$;

create or replace function public.set_my_locale(p_locale text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  if p_locale not in ('en', 'hi') then raise exception using errcode = 'P0001', message = 'Unsupported language.'; end if;
  update profiles set locale = p_locale, updated_at = now() where id = auth.uid();
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
  update profiles set full_name = public.check_person_name(p_full_name), phone = v_phone, updated_at = now()
   where id = m.user_id;
end $$;

-- ---------------------------------------------------------------------------
-- Sessions / devices (Supabase keeps one row per signed-in device)
-- ---------------------------------------------------------------------------
create or replace function public.my_sessions() returns jsonb
language sql stable security definer set search_path = public, auth as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'created_at', s.created_at, 'last_active', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
           'user_agent', s.user_agent, 'ip', host(s.ip),
           'is_current', s.id::text = coalesce(auth.jwt() ->> 'session_id', '')
         ) order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc), '[]'::jsonb)
    from auth.sessions s where s.user_id = auth.uid()
$$;

create or replace function public._revoke_sessions(p_user uuid, p_except uuid) returns int
language plpgsql security definer set search_path = public, auth as $$
declare v int;
begin
  delete from auth.sessions where user_id = p_user and (p_except is null or id <> p_except);
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.sign_out_other_sessions() returns int
language plpgsql security definer set search_path = public as $$
declare v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  if v_current is null then raise exception using errcode = 'P0001', message = 'Current session unknown.'; end if;
  return public._revoke_sessions(auth.uid(), v_current);
end $$;

create or replace function public.sign_out_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Please sign in again.'; end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
end $$;

create or replace function public.admin_sign_out_member(p_membership_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from memberships where id = p_membership_id;
  if not found then raise exception using errcode = 'P0001', message = 'Member not found.'; end if;
  perform public.assert_perm(m.society_id, 'manage_users');
  perform public.audit_append(m.society_id, 'force_sign_out', 'memberships', m.id::text, null, jsonb_build_object('user_id', m.user_id));
  return public._revoke_sessions(m.user_id, null);
end $$;

-- ---------------------------------------------------------------------------
-- Members & roles
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(p_membership_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Member not found.'; end if;
  perform public.assert_perm(m.society_id, 'manage_users');
  if p_role not in ('super_admin', 'admin', 'resident') then
    raise exception using errcode = 'P0001', message = 'Invalid role.';
  end if;
  if (p_role = 'super_admin' or m.role = 'super_admin') and not public.is_super_admin(m.society_id) then
    raise exception using errcode = '42501', message = 'Only a super admin can grant or remove super admin.';
  end if;
  if p_role = 'resident' and m.unit_id is null then
    raise exception using errcode = 'P0001', message = 'A resident must be linked to a flat.';
  end if;
  if m.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'Only active members can change role.';
  end if;
  if m.role = 'super_admin' and p_role <> 'super_admin' and (
      select count(*) from memberships where society_id = m.society_id and role = 'super_admin' and status = 'active') <= 1 then
    raise exception using errcode = 'P0001', message = 'There must always be at least one super admin.';
  end if;
  update memberships set role = p_role where id = m.id;
end $$;

create or replace function public.deactivate_membership(p_membership_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_reason text := public.clean_text(p_reason);
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Member not found.'; end if;
  perform public.assert_perm(m.society_id, 'manage_users');
  if m.status = 'deactivated' then raise exception using errcode = 'P0001', message = 'Already deactivated.'; end if;
  if m.role = 'super_admin' and not public.is_super_admin(m.society_id) then
    raise exception using errcode = '42501', message = 'Only a super admin can deactivate a super admin.';
  end if;
  if m.role = 'super_admin' and m.status = 'active' and (
      select count(*) from memberships where society_id = m.society_id and role = 'super_admin' and status = 'active') <= 1 then
    raise exception using errcode = 'P0001', message = 'There must always be at least one super admin.';
  end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a reason.';
  end if;
  update memberships set status = 'deactivated', deactivated_at = now(), deactivated_reason = left(v_reason, 300)
   where id = m.id;
  if not exists (select 1 from memberships where user_id = m.user_id and status = 'active') then
    perform public._revoke_sessions(m.user_id, null);
  end if;
end $$;

create or replace function public.reject_registration(p_membership_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found or m.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Registration not found.';
  end if;
  perform public.assert_perm(m.society_id, 'manage_users');
  update memberships set status = 'deactivated', deactivated_at = now(),
         deactivated_reason = left(coalesce(public.clean_text(p_reason), 'Registration rejected'), 300)
   where id = m.id;
  return m.user_id;
end $$;

create or replace function public.set_role_permission(p_society uuid, p_role text, p_permission text, p_allowed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_super_admin(p_society);
  if p_role <> 'admin' then
    raise exception using errcode = 'P0001', message = 'Only admin permissions can be changed.';
  end if;
  if not (p_permission = any(public.permission_catalogue())) then
    raise exception using errcode = 'P0001', message = 'Unknown permission.';
  end if;
  insert into role_permissions (society_id, role, permission, allowed) values (p_society, p_role, p_permission, p_allowed)
  on conflict (society_id, role, permission) do update set allowed = excluded.allowed;
end $$;

-- ---------------------------------------------------------------------------
-- Settings (UPI changes alert the super admin)
-- ---------------------------------------------------------------------------
create or replace function public.update_society_settings(p_society uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  old record;
  new record;
  v_key text;
begin
  perform public.assert_perm(p_society, 'manage_settings');
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('monthly_due_paise', 'due_day', 'start_month', 'share_rounding_paise', 'late_flag', 'receipt_prefix',
                     'upi_id', 'upi_payee_name', 'bank_account_name', 'upi_qr_path', 'transparency_feed',
                     'location_retention_days', 'society_name', 'society_address') then
      raise exception using errcode = 'P0001', message = format('Unknown setting: %s', v_key);
    end if;
  end loop;
  if p_patch ? 'upi_id' and public.clean_text(p_patch ->> 'upi_id') is not null
     and public.clean_text(p_patch ->> 'upi_id') !~ '^[a-zA-Z0-9.\-_]{2,255}@[a-zA-Z]{2,64}$' then
    raise exception using errcode = 'P0001', message = 'Enter a valid UPI ID, e.g. society@okhdfcbank.';
  end if;
  if p_patch ? 'upi_qr_path' and public.clean_text(p_patch ->> 'upi_qr_path') is not null
     and (p_patch ->> 'upi_qr_path') not like p_society::text || '/settings/%' then
    raise exception using errcode = 'P0001', message = 'Invalid QR image.';
  end if;
  if p_patch ? 'start_month' and not public.is_valid_period(p_patch ->> 'start_month') then
    raise exception using errcode = 'P0001', message = 'Invalid start month.';
  end if;

  select * into old from society_settings where society_id = p_society for update;
  update society_settings set
    monthly_due_paise = case when p_patch ? 'monthly_due_paise' then (p_patch ->> 'monthly_due_paise')::bigint else monthly_due_paise end,
    due_day = case when p_patch ? 'due_day' then (p_patch ->> 'due_day')::int else due_day end,
    start_month = case when p_patch ? 'start_month' then p_patch ->> 'start_month' else start_month end,
    share_rounding_paise = case when p_patch ? 'share_rounding_paise' then (p_patch ->> 'share_rounding_paise')::bigint else share_rounding_paise end,
    late_flag = case when p_patch ? 'late_flag' then (p_patch ->> 'late_flag')::boolean else late_flag end,
    receipt_prefix = case when p_patch ? 'receipt_prefix' then upper(public.clean_text(p_patch ->> 'receipt_prefix')) else receipt_prefix end,
    upi_id = case when p_patch ? 'upi_id' then public.clean_text(p_patch ->> 'upi_id') else upi_id end,
    upi_payee_name = case when p_patch ? 'upi_payee_name' then public.clean_text(p_patch ->> 'upi_payee_name') else upi_payee_name end,
    bank_account_name = case when p_patch ? 'bank_account_name' then public.clean_text(p_patch ->> 'bank_account_name') else bank_account_name end,
    upi_qr_path = case when p_patch ? 'upi_qr_path' then public.clean_text(p_patch ->> 'upi_qr_path') else upi_qr_path end,
    transparency_feed = case when p_patch ? 'transparency_feed' then (p_patch ->> 'transparency_feed')::boolean else transparency_feed end,
    location_retention_days = case when p_patch ? 'location_retention_days' then (p_patch ->> 'location_retention_days')::int else location_retention_days end,
    updated_at = now()
  where society_id = p_society;

  if p_patch ? 'society_name' or p_patch ? 'society_address' then
    update societies set
      name = case when p_patch ? 'society_name' then public.clean_text(p_patch ->> 'society_name') else name end,
      address = case when p_patch ? 'society_address' then public.clean_text(p_patch ->> 'society_address') else address end
    where id = p_society;
  end if;

  select * into new from society_settings where society_id = p_society;
  if old.upi_id is distinct from new.upi_id or old.upi_payee_name is distinct from new.upi_payee_name
     or old.upi_qr_path is distinct from new.upi_qr_path or old.bank_account_name is distinct from new.bank_account_name then
    insert into alerts (society_id, kind, title, details)
    values (p_society, 'payment_details_changed', 'Society payment details were changed',
            jsonb_build_object('by', auth.uid(), 'old_upi', old.upi_id, 'new_upi', new.upi_id,
                               'old_payee', old.upi_payee_name, 'new_payee', new.upi_payee_name,
                               'qr_changed', old.upi_qr_path is distinct from new.upi_qr_path));
    perform public._notify(p_society, public._super_admin_ids(p_society), 'payment_details_changed', null,
      'Payment details changed', format('UPI ID is now %s. If you did not expect this, check immediately.', coalesce(new.upi_id, '(none)')),
      '/admin/alerts');
  end if;
end $$;

create or replace function public.upsert_expense_category(p_society uuid, p_code text, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text := lower(public.clean_text(p_code));
begin
  perform public.assert_perm(p_society, 'record_expense');
  if v_code is null or v_code !~ '^[a-z][a-z0-9_]{1,30}$'
     or v_code in ('maintenance', 'event_contribution', 'transfer', 'opening_balance', 'adjustment') then
    raise exception using errcode = 'P0001', message = 'Category code must be lowercase letters/digits/underscore and not reserved.';
  end if;
  if char_length(coalesce(public.clean_text(p_label), '')) < 1 then
    raise exception using errcode = 'P0001', message = 'Label is required.';
  end if;
  insert into expense_categories (society_id, code, label, sort_order)
  values (p_society, v_code, left(public.clean_text(p_label), 40), 100)
  on conflict (society_id, code) do update set label = excluded.label;
end $$;

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------
create or replace function public.upsert_unit_type(p_society uuid, p_id uuid, p_name text, p_monthly_due_paise bigint, p_sort_order int)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := public.clean_text(p_name);
begin
  perform public.assert_perm(p_society, 'manage_units');
  if v_name is null or char_length(v_name) > 30 then
    raise exception using errcode = 'P0001', message = 'Type name is required (max 30 characters).';
  end if;
  if p_monthly_due_paise is not null then perform public._check_amount(p_monthly_due_paise); end if;
  if p_id is null then
    insert into unit_types (society_id, name, monthly_due_paise, sort_order)
    values (p_society, v_name, p_monthly_due_paise, coalesce(p_sort_order, 0)) returning id into v_id;
  else
    update unit_types set name = v_name, monthly_due_paise = p_monthly_due_paise, sort_order = coalesce(p_sort_order, sort_order)
     where id = p_id and society_id = p_society returning id into v_id;
    if v_id is null then raise exception using errcode = 'P0001', message = 'Type not found.'; end if;
  end if;
  return v_id;
end $$;

-- p_units: [{code, display_name, unit_type_id, block_name?, floor_name?, floor_level?, is_billable?, status?, sort_order?}]
create or replace function public.create_units_bulk(p_society uuid, p_units jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  x jsonb;
  v_code text;
  v_block uuid;
  v_floor uuid;
  v_count int := 0;
  v_dupes text[];
begin
  perform public.assert_perm(p_society, 'manage_units');
  if jsonb_typeof(p_units) <> 'array' or jsonb_array_length(p_units) = 0 then
    raise exception using errcode = 'P0001', message = 'Nothing to create.';
  end if;
  if jsonb_array_length(p_units) > 2000 then
    raise exception using errcode = 'P0001', message = 'Create at most 2000 units at a time.';
  end if;
  select array_agg(c) into v_dupes from (
    select upper(e ->> 'code') c from jsonb_array_elements(p_units) e group by 1 having count(*) > 1
    union
    select upper(e ->> 'code') from jsonb_array_elements(p_units) e
     where exists (select 1 from units u where u.society_id = p_society and u.code = upper(e ->> 'code'))
  ) t;
  if v_dupes is not null then
    raise exception using errcode = 'P0001', message = 'These codes already exist or repeat: ' || array_to_string(v_dupes[1:10], ', ');
  end if;

  for x in select * from jsonb_array_elements(p_units) loop
    v_code := upper(btrim(x ->> 'code'));
    if v_code !~ '^[A-Z0-9][A-Z0-9-]{0,19}$' then
      raise exception using errcode = 'P0001', message = format('Invalid unit code "%s" (letters, digits and dashes only).', v_code);
    end if;
    if not exists (select 1 from unit_types where id = (x ->> 'unit_type_id')::uuid and society_id = p_society) then
      raise exception using errcode = 'P0001', message = format('Unknown flat type for %s.', v_code);
    end if;
    v_block := null; v_floor := null;
    if public.clean_text(x ->> 'block_name') is not null then
      insert into blocks (society_id, name, sort_order) values (p_society, public.clean_text(x ->> 'block_name'), 0)
      on conflict (society_id, name) do update set name = excluded.name returning id into v_block;
    end if;
    if public.clean_text(x ->> 'floor_name') is not null then
      select id into v_floor from floors
       where society_id = p_society and block_id is not distinct from v_block and name = public.clean_text(x ->> 'floor_name');
      if v_floor is null then
        insert into floors (society_id, block_id, name, level)
        values (p_society, v_block, public.clean_text(x ->> 'floor_name'), coalesce((x ->> 'floor_level')::int, 0))
        returning id into v_floor;
      end if;
    end if;
    insert into units (society_id, block_id, floor_id, code, display_name, unit_type_id, status, is_billable, sort_order)
    values (p_society, v_block, v_floor, v_code, coalesce(public.clean_text(x ->> 'display_name'), v_code),
            (x ->> 'unit_type_id')::uuid, coalesce(x ->> 'status', 'occupied'), coalesce((x ->> 'is_billable')::boolean, true),
            coalesce((x ->> 'sort_order')::int, v_count));
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('created', v_count);
end $$;

create or replace function public.update_unit(p_unit_id uuid, p_display_name text, p_unit_type_id uuid, p_status text, p_is_billable boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Unit not found.'; end if;
  perform public.assert_perm(v_society, 'manage_units');
  if not exists (select 1 from unit_types where id = p_unit_type_id and society_id = v_society) then
    raise exception using errcode = 'P0001', message = 'Unknown flat type.';
  end if;
  if p_status not in ('occupied', 'vacant') then
    raise exception using errcode = 'P0001', message = 'Invalid status.';
  end if;
  update units set display_name = coalesce(public.clean_text(p_display_name), display_name), unit_type_id = p_unit_type_id,
         status = p_status, is_billable = coalesce(p_is_billable, is_billable)
   where id = p_unit_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notices with acknowledgement
-- ---------------------------------------------------------------------------
create or replace function public._audience(p_society uuid, p_type text, p_type_ids uuid[], p_unit_ids uuid[])
returns table (user_id uuid, unit_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (m.user_id) m.user_id, m.unit_id
    from memberships m left join units u on u.id = m.unit_id
   where m.society_id = p_society and m.status = 'active'
     and (p_type = 'all'
          or (p_type = 'unit_types' and u.unit_type_id = any(p_type_ids))
          or (p_type = 'units' and m.unit_id = any(p_unit_ids)))
   order by m.user_id
$$;

create or replace function public.send_notice(
  p_society uuid, p_title text, p_body text, p_priority text, p_attachment_path text,
  p_audience_type text, p_unit_type_ids uuid[], p_unit_ids uuid[], p_require_ack boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_title text := public.clean_text(p_title);
  v_body text := public.clean_body(p_body);
  v_users uuid[];
begin
  perform public.assert_perm(p_society, 'send_notices');
  if char_length(coalesce(v_title, '')) not between 3 and 120 then
    raise exception using errcode = 'P0001', message = 'Title must be 3–120 characters.';
  end if;
  if char_length(coalesce(v_body, '')) not between 1 and 5000 then
    raise exception using errcode = 'P0001', message = 'Message must be 1–5000 characters.';
  end if;
  if p_priority not in ('normal', 'important') then
    raise exception using errcode = 'P0001', message = 'Invalid priority.';
  end if;
  if p_audience_type not in ('all', 'unit_types', 'units') then
    raise exception using errcode = 'P0001', message = 'Choose who should receive this notice.';
  end if;
  if p_attachment_path is not null and p_attachment_path not like p_society::text || '/notices/%' then
    raise exception using errcode = 'P0001', message = 'Invalid attachment.';
  end if;

  select array_agg(a.user_id) into v_users
    from public._audience(p_society, p_audience_type, coalesce(p_unit_type_ids, '{}'), coalesce(p_unit_ids, '{}')) a
   where a.user_id <> auth.uid();
  if coalesce(array_length(v_users, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'No active members in this audience.';
  end if;

  insert into notices (society_id, title, body, priority, attachment_path, audience_type, audience_unit_type_ids,
                       audience_unit_ids, require_ack, created_by)
  values (p_society, v_title, v_body, p_priority, p_attachment_path, p_audience_type,
          case when p_audience_type = 'unit_types' then coalesce(p_unit_type_ids, '{}') else '{}' end,
          case when p_audience_type = 'units' then coalesce(p_unit_ids, '{}') else '{}' end,
          coalesce(p_require_ack, true), auth.uid())
  returning id into v_id;

  insert into notice_receipts (notice_id, society_id, user_id, unit_id)
  select v_id, p_society, a.user_id, a.unit_id
    from public._audience(p_society, p_audience_type, coalesce(p_unit_type_ids, '{}'), coalesce(p_unit_ids, '{}')) a
   where a.user_id <> auth.uid();

  perform public._notify(p_society, v_users, 'notice', v_id,
    case when p_priority = 'important' then 'Important: ' else '' end || v_title,
    left(regexp_replace(v_body, '\s+', ' ', 'g'), 160), '/notices/' || v_id);
  return v_id;
end $$;

create or replace function public.mark_notices_delivered(p_society uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  update notice_receipts set delivered_at = now()
   where society_id = p_society and user_id = auth.uid() and delivered_at is null;
end $$;

create or replace function public.mark_notice_opened(p_notice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notice_receipts set opened_at = coalesce(opened_at, now()), delivered_at = coalesce(delivered_at, now())
   where notice_id = p_notice_id and user_id = auth.uid() and opened_at is null;
  update notifications set read_at = now() where user_id = auth.uid() and kind = 'notice' and ref_id = p_notice_id and read_at is null;
end $$;

create or replace function public.acknowledge_notice(
  p_notice_id uuid, p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_lat double precision := p_lat; v_lng double precision := p_lng; v_acc double precision := p_accuracy;
begin
  select * into r from notice_receipts where notice_id = p_notice_id and user_id = auth.uid() for update;
  if not found then raise exception using errcode = 'P0001', message = 'Notice not found.'; end if;
  perform public.assert_member(r.society_id);
  if r.acknowledged_at is not null then
    return jsonb_build_object('acknowledged_at', r.acknowledged_at, 'already', true);
  end if;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    v_lat := null; v_lng := null; v_acc := null;
  end if;
  if v_acc is not null and (v_acc < 0 or v_acc > 100000) then v_acc := null; end if;
  update notice_receipts set
    acknowledged_at = now(), opened_at = coalesce(opened_at, now()), delivered_at = coalesce(delivered_at, now()),
    ack_ip = public.request_ip(), ack_user_agent = public.request_user_agent(),
    ack_lat = v_lat, ack_lng = v_lng, ack_accuracy = v_acc
   where id = r.id;
  update notifications set read_at = now() where user_id = auth.uid() and kind = 'notice' and ref_id = p_notice_id and read_at is null;
  return jsonb_build_object('acknowledged_at', now());
end $$;

create or replace function public.remind_notice_pending(p_notice_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n record; v_users uuid[];
begin
  select * into n from notices where id = p_notice_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Notice not found.'; end if;
  perform public.assert_perm(n.society_id, 'send_notices');
  if n.archived_at is not null then raise exception using errcode = 'P0001', message = 'This notice is archived.'; end if;
  if n.last_reminded_at is not null and n.last_reminded_at > now() - interval '10 minutes' then
    raise exception using errcode = 'P0001', message = 'A reminder was sent less than 10 minutes ago.';
  end if;
  select array_agg(user_id) into v_users from notice_receipts where notice_id = n.id and acknowledged_at is null;
  if coalesce(array_length(v_users, 1), 0) = 0 then return 0; end if;
  update notices set last_reminded_at = now() where id = n.id;
  return public._notify(n.society_id, v_users, 'notice', n.id, 'Reminder: ' || n.title,
    'Please read and acknowledge this notice.', '/notices/' || n.id);
end $$;

create or replace function public.archive_notice(p_notice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from notices where id = p_notice_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Notice not found.'; end if;
  perform public.assert_perm(v_society, 'send_notices');
  update notices set archived_at = now() where id = p_notice_id and archived_at is null;
end $$;

create or replace function public.purge_old_locations(p_society uuid, p_older_than_days int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  perform public.assert_super_admin(p_society);
  if p_older_than_days is null or p_older_than_days < 0 then
    raise exception using errcode = 'P0001', message = 'Invalid number of days.';
  end if;
  update notice_receipts set ack_lat = null, ack_lng = null, ack_accuracy = null
   where society_id = p_society and ack_lat is not null and acknowledged_at < now() - make_interval(days => p_older_than_days);
  get diagnostics v = row_count;
  perform public.audit_append(p_society, 'purge_locations', 'notice_receipts', null, null,
                              jsonb_build_object('older_than_days', p_older_than_days, 'rows', v));
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- In-app notifications and Web Push subscriptions
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
end $$;

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
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

create or replace function public.my_push_devices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'device_label', device_label, 'last_seen', last_seen)
                            order by last_seen desc), '[]'::jsonb)
    from push_subscriptions where user_id = auth.uid()
$$;

-- Service role only: claim a batch of pending pushes (safe with concurrent dispatchers)
create or replace function public._claim_push_batch(p_limit int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select id from notifications
     where (push_status = 'pending' or (push_status = 'sending' and pushed_at < now() - interval '5 minutes'))
       and created_at > now() - interval '2 days'
     order by created_at
     limit greatest(1, least(p_limit, 500))
     for update skip locked
  ), upd as (
    update notifications n set push_status = 'sending', push_attempts = push_attempts + 1, pushed_at = now()
      from picked where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u.id, 'user_id', u.user_id, 'kind', u.kind, 'ref_id', u.ref_id, 'title', u.title, 'body', u.body, 'url', u.url,
           'attempts', u.push_attempts,
           'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
                               from push_subscriptions s where s.user_id = u.user_id))), '[]'::jsonb)
    into v from upd u;
  return v;
end $$;

create or replace function public._finish_push(p_id uuid, p_status text, p_dead_endpoints text[]) returns void
language plpgsql security definer set search_path = public as $$
declare n record;
begin
  update notifications set push_status = p_status, pushed_at = now() where id = p_id returning * into n;
  if p_dead_endpoints is not null then
    delete from push_subscriptions where endpoint = any(p_dead_endpoints);
  end if;
  if p_status = 'sent' and n.kind = 'notice' and n.ref_id is not null then
    update notice_receipts set delivered_at = coalesce(delivered_at, now()) where notice_id = n.ref_id and user_id = n.user_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Member concerns (private helpdesk)
-- ---------------------------------------------------------------------------
create or replace function public.can_view_concern(p_concern_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from concerns c
     where c.id = p_concern_id
       and ((c.raised_by = auth.uid() and public.is_member(c.society_id)) or public.is_admin(c.society_id))
  )
$$;

create or replace view public.v_concerns as
select
  c.id, c.society_id,
  case when c.raised_by = auth.uid() or not c.hide_name or public.is_super_admin(c.society_id) then c.unit_id end as unit_id,
  case when c.raised_by = auth.uid() or not c.hide_name or public.is_super_admin(c.society_id) then u.code end as unit_code,
  case when c.raised_by = auth.uid() or not c.hide_name or public.is_super_admin(c.society_id) then c.raised_by end as raised_by,
  case when c.raised_by = auth.uid() or not c.hide_name or public.is_super_admin(c.society_id) then p.full_name end as raiser_name,
  (c.raised_by = auth.uid()) as is_mine,
  c.title, c.category, c.priority, c.status, c.assigned_to, ap.full_name as assignee_name, c.hide_name,
  c.created_at, c.updated_at, c.resolved_at, c.closed_at, c.last_message_at,
  (c.last_message_at > coalesce(cr.last_read_at, '-infinity'::timestamptz)) as unread,
  (select count(*) from concern_messages m where m.concern_id = c.id)::int as message_count
from public.concerns c
left join public.units u on u.id = c.unit_id
left join public.profiles p on p.id = c.raised_by
left join public.profiles ap on ap.id = c.assigned_to
left join public.concern_reads cr on cr.concern_id = c.id and cr.user_id = auth.uid()
where (c.raised_by = auth.uid() and public.is_member(c.society_id)) or public.is_admin(c.society_id);

create or replace view public.v_concern_messages as
select
  m.id, m.concern_id, m.society_id,
  case when m.author_id = auth.uid() or not (c.hide_name and m.author_id = c.raised_by) or public.is_super_admin(c.society_id)
       then m.author_id end as author_id,
  case when m.author_id = auth.uid() or not (c.hide_name and m.author_id = c.raised_by) or public.is_super_admin(c.society_id)
       then p.full_name else 'Member (name hidden)' end as author_name,
  (m.author_id = auth.uid()) as is_mine,
  coalesce((select am.role from memberships am where am.user_id = m.author_id and am.society_id = m.society_id
             and am.status = 'active' order by am.created_at limit 1), 'resident') as author_role,
  case when m.hidden_at is null or public.is_admin(m.society_id) then m.body else null end as body,
  case when m.hidden_at is null or public.is_admin(m.society_id) then m.attachment_path else null end as attachment_path,
  m.is_system, m.created_at, m.hidden_at, m.hidden_reason
from public.concern_messages m
join public.concerns c on c.id = m.concern_id
left join public.profiles p on p.id = m.author_id
where (c.raised_by = auth.uid() and public.is_member(c.society_id)) or public.is_admin(c.society_id);

revoke all on public.v_concerns, public.v_concern_messages from anon;
grant select on public.v_concerns, public.v_concern_messages to authenticated;

create or replace function public.raise_concern(
  p_society uuid, p_title text, p_category text, p_body text, p_priority text, p_attachment_path text, p_hide_name boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_unit uuid; v_title text := public.clean_text(p_title); v_body text := public.clean_body(p_body); v_code text;
begin
  perform public.assert_member(p_society);
  if char_length(coalesce(v_title, '')) not between 3 and 120 then
    raise exception using errcode = 'P0001', message = 'Title must be 3–120 characters.';
  end if;
  if char_length(coalesce(v_body, '')) not between 1 and 4000 then
    raise exception using errcode = 'P0001', message = 'Describe the concern (up to 4000 characters).';
  end if;
  if p_category not in ('security', 'cleanliness', 'water', 'electricity', 'payments', 'neighbour', 'suggestion', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose a category.';
  end if;
  if coalesce(p_priority, 'normal') not in ('normal', 'urgent') then
    raise exception using errcode = 'P0001', message = 'Invalid priority.';
  end if;
  if (select count(*) from concerns where raised_by = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception using errcode = 'P0001', message = 'You have raised many concerns today. Please wait for replies.';
  end if;
  select unit_id into v_unit from memberships where user_id = auth.uid() and society_id = p_society and status = 'active' limit 1;
  if p_attachment_path is not null and p_attachment_path not like p_society::text || '/concerns/%' then
    raise exception using errcode = 'P0001', message = 'Invalid attachment.';
  end if;

  insert into concerns (society_id, unit_id, raised_by, title, category, priority, hide_name)
  values (p_society, v_unit, auth.uid(), v_title, p_category, coalesce(p_priority, 'normal'), coalesce(p_hide_name, false))
  returning id into v_id;
  insert into concern_messages (concern_id, society_id, author_id, body, attachment_path)
  values (v_id, p_society, auth.uid(), v_body, p_attachment_path);
  insert into concern_reads (concern_id, user_id) values (v_id, auth.uid())
  on conflict (concern_id, user_id) do update set last_read_at = now();

  select code into v_code from units where id = v_unit;
  perform public._notify(p_society, array(select unnest(public._admin_ids(p_society)) except select auth.uid()), 'concern_new', v_id,
    case when p_priority = 'urgent' then 'Urgent concern: ' else 'New concern: ' end || v_title,
    case when coalesce(p_hide_name, false) then 'From a member' else coalesce('From ' || v_code, 'From a member') end,
    '/concerns/' || v_id);
  return v_id;
end $$;

-- Concern attachments live at {society}/concerns/{concern_id}/... ; the first upload happens before
-- the concern exists, so it uses {society}/concerns/new-{user_id}/... which only the uploader and admins can read.

create or replace function public.reply_concern(p_concern_id uuid, p_body text, p_attachment_path text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c record; v_body text := public.clean_body(p_body); v_id uuid; v_is_admin boolean; v_targets uuid[];
begin
  select * into c from concerns where id = p_concern_id for update;
  if not found or not public.can_view_concern(p_concern_id) then
    raise exception using errcode = 'P0001', message = 'Concern not found.';
  end if;
  if c.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'This concern is closed.';
  end if;
  if char_length(coalesce(v_body, '')) not between 1 and 4000 then
    raise exception using errcode = 'P0001', message = 'Message must be 1–4000 characters.';
  end if;
  if p_attachment_path is not null and p_attachment_path not like c.society_id::text || '/concerns/%' then
    raise exception using errcode = 'P0001', message = 'Invalid attachment.';
  end if;
  v_is_admin := public.is_admin(c.society_id);
  insert into concern_messages (concern_id, society_id, author_id, body, attachment_path)
  values (c.id, c.society_id, auth.uid(), v_body, p_attachment_path) returning id into v_id;
  update concerns set last_message_at = now(), updated_at = now(),
         status = case when v_is_admin and c.raised_by <> auth.uid() and c.status = 'open' then 'in_progress' else status end
   where id = c.id;
  insert into concern_reads (concern_id, user_id) values (c.id, auth.uid())
  on conflict (concern_id, user_id) do update set last_read_at = now();

  if c.raised_by <> auth.uid() then
    v_targets := array[c.raised_by];
  elsif c.assigned_to is not null then
    v_targets := array[c.assigned_to];
  else
    v_targets := public._admin_ids(c.society_id);
  end if;
  perform public._notify(c.society_id, array(select unnest(v_targets) except select auth.uid()), 'concern_reply', c.id,
    'New reply: ' || c.title, left(regexp_replace(v_body, '\s+', ' ', 'g'), 140), '/concerns/' || c.id);
  return v_id;
end $$;

create or replace function public.set_concern_status(p_concern_id uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_is_admin boolean; v_note text := public.clean_text(p_note); v_label text;
begin
  select * into c from concerns where id = p_concern_id for update;
  if not found or not public.can_view_concern(p_concern_id) then
    raise exception using errcode = 'P0001', message = 'Concern not found.';
  end if;
  if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
    raise exception using errcode = 'P0001', message = 'Invalid status.';
  end if;
  if p_status = c.status then return; end if;
  v_is_admin := public.is_admin(c.society_id);
  if not v_is_admin then
    -- the member may reopen within 7 days of resolution, or close their own concern
    if not ((p_status = 'open' and c.status = 'resolved' and c.resolved_at > now() - interval '7 days')
            or p_status = 'closed') then
      raise exception using errcode = 'P0001', message = 'You can reopen only within 7 days of it being resolved.';
    end if;
  end if;
  update concerns set status = p_status, updated_at = now(), last_message_at = now(),
         resolved_at = case when p_status = 'resolved' then now() when p_status in ('open', 'in_progress') then null else resolved_at end,
         closed_at = case when p_status = 'closed' then now() else null end
   where id = c.id;
  v_label := initcap(replace(p_status, '_', ' '));
  insert into concern_messages (concern_id, society_id, author_id, body, is_system)
  values (c.id, c.society_id, auth.uid(), 'Status changed to ' || v_label || coalesce(' — ' || v_note, ''), true);

  if c.raised_by <> auth.uid() then
    perform public._notify(c.society_id, array[c.raised_by], 'concern_status', c.id,
      c.title || ': ' || v_label, coalesce(v_note, 'Status updated'), '/concerns/' || c.id);
  else
    perform public._notify(c.society_id,
      array(select unnest(case when c.assigned_to is not null then array[c.assigned_to] else public._admin_ids(c.society_id) end)
            except select auth.uid()),
      'concern_status', c.id, c.title || ': ' || v_label, coalesce(v_note, 'Updated by the member'), '/concerns/' || c.id);
  end if;
end $$;

create or replace function public.assign_concern(p_concern_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_name text;
begin
  select * into c from concerns where id = p_concern_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Concern not found.'; end if;
  if not public.is_admin(c.society_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  perform public.assert_member(c.society_id);
  if p_user_id is not null and coalesce(public.user_role(p_user_id, c.society_id), '') not in ('admin', 'super_admin') then
    raise exception using errcode = 'P0001', message = 'Concerns can only be assigned to an admin.';
  end if;
  update concerns set assigned_to = p_user_id, updated_at = now() where id = c.id;
  select full_name into v_name from profiles where id = p_user_id;
  insert into concern_messages (concern_id, society_id, author_id, body, is_system)
  values (c.id, c.society_id, auth.uid(), coalesce('Assigned to ' || v_name, 'Unassigned'), true);
  if p_user_id is not null and p_user_id <> auth.uid() then
    perform public._notify(c.society_id, array[p_user_id], 'concern_assigned', c.id, 'Concern assigned to you', c.title, '/concerns/' || c.id);
  end if;
end $$;

create or replace function public.hide_concern_message(p_message_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_reason text := public.clean_text(p_reason);
begin
  select * into m from concern_messages where id = p_message_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Message not found.'; end if;
  if not public.is_admin(m.society_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a reason for hiding this message.';
  end if;
  update concern_messages set hidden_by = auth.uid(), hidden_reason = left(v_reason, 300), hidden_at = now() where id = m.id;
end $$;

create or replace function public.mark_concern_read(p_concern_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_view_concern(p_concern_id) then return; end if;
  insert into concern_reads (concern_id, user_id) values (p_concern_id, auth.uid())
  on conflict (concern_id, user_id) do update set last_read_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Contacts directory
-- ---------------------------------------------------------------------------
create or replace function public.upsert_contact_category(p_society uuid, p_id uuid, p_name text, p_sort_order int, p_is_pinned boolean)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := public.clean_text(p_name);
begin
  perform public.assert_perm(p_society, 'manage_contacts');
  if char_length(coalesce(v_name, '')) not between 2 and 40 then
    raise exception using errcode = 'P0001', message = 'Category name must be 2–40 characters.';
  end if;
  if p_id is null then
    insert into contact_categories (society_id, name, sort_order, is_pinned)
    values (p_society, v_name, coalesce(p_sort_order, 50), coalesce(p_is_pinned, false)) returning id into v_id;
  else
    update contact_categories set name = v_name, sort_order = coalesce(p_sort_order, sort_order), is_pinned = coalesce(p_is_pinned, is_pinned)
     where id = p_id and society_id = p_society returning id into v_id;
    if v_id is null then raise exception using errcode = 'P0001', message = 'Category not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.upsert_contact(
  p_society uuid, p_id uuid, p_category_id uuid, p_name text, p_phone text, p_alt_phone text,
  p_whatsapp boolean, p_notes text, p_timings text, p_typical_rate text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := public.clean_text(p_name);
begin
  perform public.assert_perm(p_society, 'manage_contacts');
  if not exists (select 1 from contact_categories where id = p_category_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a category.';
  end if;
  if char_length(coalesce(v_name, '')) not between 2 and 60 then
    raise exception using errcode = 'P0001', message = 'Name must be 2–60 characters.';
  end if;
  if public.norm_phone(p_phone) is null then
    raise exception using errcode = 'P0001', message = 'Phone number is required.';
  end if;
  if p_id is null then
    insert into contacts (society_id, category_id, name, phone, alt_phone, whatsapp, notes, timings, typical_rate, added_by, approved_by)
    values (p_society, p_category_id, v_name, public.norm_phone(p_phone), public.norm_phone(p_alt_phone), coalesce(p_whatsapp, true),
            left(public.clean_text(p_notes), 300), left(public.clean_text(p_timings), 80), left(public.clean_text(p_typical_rate), 80),
            auth.uid(), auth.uid())
    returning id into v_id;
  else
    update contacts set category_id = p_category_id, name = v_name, phone = public.norm_phone(p_phone),
           alt_phone = public.norm_phone(p_alt_phone), whatsapp = coalesce(p_whatsapp, true),
           notes = left(public.clean_text(p_notes), 300), timings = left(public.clean_text(p_timings), 80),
           typical_rate = left(public.clean_text(p_typical_rate), 80), updated_at = now()
     where id = p_id and society_id = p_society returning id into v_id;
    if v_id is null then raise exception using errcode = 'P0001', message = 'Contact not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.suggest_contact(p_society uuid, p_category_id uuid, p_name text, p_phone text, p_notes text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := public.clean_text(p_name);
begin
  perform public.assert_member(p_society);
  if not exists (select 1 from contact_categories where id = p_category_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a category.';
  end if;
  if char_length(coalesce(v_name, '')) not between 2 and 60 then
    raise exception using errcode = 'P0001', message = 'Name must be 2–60 characters.';
  end if;
  if public.norm_phone(p_phone) is null then
    raise exception using errcode = 'P0001', message = 'Phone number is required.';
  end if;
  if (select count(*) from contacts where added_by = auth.uid() and status = 'suggested') >= 5 then
    raise exception using errcode = 'P0001', message = 'You already have several suggestions waiting for approval.';
  end if;
  insert into contacts (society_id, category_id, name, phone, notes, status, added_by)
  values (p_society, p_category_id, v_name, public.norm_phone(p_phone), left(public.clean_text(p_notes), 300), 'suggested', auth.uid())
  returning id into v_id;
  perform public._notify(p_society, public._perm_user_ids(p_society, 'manage_contacts'), 'contact_suggested', v_id,
    'New contact suggestion', v_name, '/contacts');
  return v_id;
end $$;

create or replace function public.review_contact(p_contact_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from contacts where id = p_contact_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Contact not found.'; end if;
  perform public.assert_perm(c.society_id, 'manage_contacts');
  if c.status <> 'suggested' then raise exception using errcode = 'P0001', message = 'Already reviewed.'; end if;
  update contacts set status = case when p_approve then 'active' else 'rejected' end, approved_by = auth.uid(), updated_at = now()
   where id = c.id;
end $$;

create or replace function public.archive_contact(p_contact_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from contacts where id = p_contact_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Contact not found.'; end if;
  perform public.assert_perm(v_society, 'manage_contacts');
  update contacts set status = 'archived', updated_at = now() where id = p_contact_id;
end $$;

-- ---------------------------------------------------------------------------
-- Maintenance reminders
-- ---------------------------------------------------------------------------
create or replace function public.next_reminder_date(p_date date, p_unit text, p_count int) returns date
language sql immutable set search_path = public as $$
  select case when p_unit = 'days' then p_date + p_count else (p_date + make_interval(months => p_count))::date end
$$;

create or replace function public.upsert_reminder(
  p_society uuid, p_id uuid, p_title text, p_message text, p_interval_unit text, p_interval_count int, p_next_date date,
  p_audience_type text, p_unit_type_ids uuid[], p_unit_ids uuid[], p_contact_category_id uuid, p_kind text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_title text := public.clean_text(p_title); v_msg text := public.clean_body(p_message);
begin
  perform public.assert_perm(p_society, 'manage_reminders');
  if char_length(coalesce(v_title, '')) not between 3 and 80 then
    raise exception using errcode = 'P0001', message = 'Title must be 3–80 characters.';
  end if;
  if char_length(coalesce(v_msg, '')) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'Message must be 1–500 characters.';
  end if;
  if p_interval_unit not in ('days', 'months') or p_interval_count is null or p_interval_count not between 1 and 365 then
    raise exception using errcode = 'P0001', message = 'Choose how often this repeats.';
  end if;
  if p_next_date is null then raise exception using errcode = 'P0001', message = 'Choose the next date.'; end if;
  if p_audience_type not in ('all', 'unit_types', 'units') then
    raise exception using errcode = 'P0001', message = 'Choose the audience.';
  end if;
  if p_kind not in ('advisory', 'task') then raise exception using errcode = 'P0001', message = 'Choose the type.'; end if;
  if p_contact_category_id is not null and not exists (select 1 from contact_categories where id = p_contact_category_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Unknown contact category.';
  end if;
  if p_id is null then
    insert into reminder_schedules (society_id, title, message, interval_unit, interval_count, next_date, audience_type,
                                    audience_unit_type_ids, audience_unit_ids, contact_category_id, kind, created_by)
    values (p_society, v_title, v_msg, p_interval_unit, p_interval_count, p_next_date, p_audience_type,
            coalesce(p_unit_type_ids, '{}'), coalesce(p_unit_ids, '{}'), p_contact_category_id, p_kind, auth.uid())
    returning id into v_id;
  else
    update reminder_schedules set title = v_title, message = v_msg, interval_unit = p_interval_unit, interval_count = p_interval_count,
           next_date = p_next_date, audience_type = p_audience_type, audience_unit_type_ids = coalesce(p_unit_type_ids, '{}'),
           audience_unit_ids = coalesce(p_unit_ids, '{}'), contact_category_id = p_contact_category_id, kind = p_kind, updated_at = now()
     where id = p_id and society_id = p_society and deleted_at is null returning id into v_id;
    if v_id is null then raise exception using errcode = 'P0001', message = 'Reminder not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.set_reminder_paused(p_id uuid, p_paused boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from reminder_schedules where id = p_id and deleted_at is null;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Reminder not found.'; end if;
  perform public.assert_perm(v_society, 'manage_reminders');
  update reminder_schedules set is_paused = p_paused, updated_at = now() where id = p_id;
end $$;

create or replace function public.delete_reminder(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from reminder_schedules where id = p_id and deleted_at is null;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Reminder not found.'; end if;
  perform public.assert_perm(v_society, 'manage_reminders');
  update reminder_schedules set deleted_at = now(), updated_at = now() where id = p_id;
end $$;

create or replace function public.respond_reminder(p_occurrence_id uuid, p_response text) returns void
language plpgsql security definer set search_path = public as $$
declare o record; s record; v_unit uuid;
begin
  select * into o from reminder_occurrences where id = p_occurrence_id;
  if not found then raise exception using errcode = 'P0001', message = 'Reminder not found.'; end if;
  perform public.assert_member(o.society_id);
  select * into s from reminder_schedules where id = o.schedule_id;
  if s.kind <> 'advisory' then raise exception using errcode = 'P0001', message = 'Only advisory reminders take responses.'; end if;
  select unit_id into v_unit from memberships
   where user_id = auth.uid() and society_id = o.society_id and status = 'active' and unit_id is not null limit 1;
  if v_unit is null then raise exception using errcode = 'P0001', message = 'Only flat logins can respond.'; end if;
  if p_response not in ('done', 'snooze') then raise exception using errcode = 'P0001', message = 'Invalid response.'; end if;
  insert into reminder_responses (occurrence_id, society_id, unit_id, user_id, response, snooze_until)
  values (o.id, o.society_id, v_unit, auth.uid(), p_response,
          case when p_response = 'snooze' then (public.ist_today() + interval '1 month')::date end)
  on conflict (occurrence_id, unit_id) do update set response = excluded.response, snooze_until = excluded.snooze_until,
    snooze_notified = false, user_id = excluded.user_id, created_at = now();
end $$;

create or replace function public.complete_reminder_task(
  p_schedule_id uuid, p_done_on date, p_cost_paise bigint, p_post_expense boolean, p_fund_id uuid,
  p_category text, p_payee text, p_payment_mode text, p_note text, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_entry uuid; v_id uuid; v_res jsonb;
begin
  select * into s from reminder_schedules where id = p_schedule_id and deleted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'Task not found.'; end if;
  perform public.assert_perm(s.society_id, 'manage_reminders');
  if s.kind <> 'task' then raise exception using errcode = 'P0001', message = 'This is not a society task.'; end if;
  if p_done_on is null or p_done_on > public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Done date cannot be in the future.';
  end if;
  if p_cost_paise is not null then perform public._check_amount(p_cost_paise); end if;
  if coalesce(p_post_expense, false) then
    if p_cost_paise is null then raise exception using errcode = 'P0001', message = 'Enter the cost to post an expense.'; end if;
    v_res := public.record_expense(coalesce(p_fund_id, public.general_fund_id(s.society_id)), coalesce(p_category, 'repair'),
                                   p_payee, p_cost_paise, p_done_on, coalesce(p_payment_mode, 'cash'), null,
                                   coalesce(public.clean_text(p_note), s.title), null, coalesce(p_idempotency_key, gen_random_uuid()::text),
                                   'Society task: ' || s.title, null, false);
    v_entry := (v_res ->> 'entry_id')::uuid;
  end if;
  insert into reminder_task_logs (schedule_id, society_id, done_on, cost_paise, ledger_entry_id, note, done_by)
  values (s.id, s.society_id, p_done_on, p_cost_paise, v_entry, left(public.clean_text(p_note), 500), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.my_reminder_cards(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit uuid; v_type uuid; v_is_admin boolean;
begin
  perform public.assert_member(p_society);
  v_is_admin := public.has_perm(p_society, 'manage_reminders');
  select m.unit_id, u.unit_type_id into v_unit, v_type from memberships m left join units u on u.id = m.unit_id
   where m.user_id = auth.uid() and m.society_id = p_society and m.status = 'active' limit 1;
  return coalesce((
    select jsonb_agg(card order by (card ->> 'due_date') desc) from (
      -- advisory cards for my flat
      select jsonb_build_object('occurrence_id', o.id, 'schedule_id', s.id, 'kind', s.kind, 'title', s.title, 'message', s.message,
                                'due_date', o.due_date, 'contact_category_id', s.contact_category_id) as card
        from reminder_occurrences o join reminder_schedules s on s.id = o.schedule_id
       where o.society_id = p_society and s.kind = 'advisory' and s.deleted_at is null and v_unit is not null
         and o.due_date > public.ist_today() - 45
         and o.id = (select o2.id from reminder_occurrences o2 where o2.schedule_id = s.id order by o2.due_date desc limit 1)
         and (s.audience_type = 'all' or (s.audience_type = 'unit_types' and v_type = any(s.audience_unit_type_ids))
              or (s.audience_type = 'units' and v_unit = any(s.audience_unit_ids)))
         and not exists (select 1 from reminder_responses r where r.occurrence_id = o.id and r.unit_id = v_unit
                          and (r.response = 'done' or r.snooze_until > public.ist_today()))
      union all
      -- open society tasks for admins
      select jsonb_build_object('occurrence_id', o.id, 'schedule_id', s.id, 'kind', s.kind, 'title', s.title, 'message', s.message,
                                'due_date', o.due_date, 'contact_category_id', s.contact_category_id)
        from reminder_occurrences o join reminder_schedules s on s.id = o.schedule_id
       where v_is_admin and o.society_id = p_society and s.kind = 'task' and s.deleted_at is null
         and o.id = (select o2.id from reminder_occurrences o2 where o2.schedule_id = s.id order by o2.due_date desc limit 1)
         and not exists (select 1 from reminder_task_logs l where l.schedule_id = s.id and l.created_at >= o.sent_at)
    ) t), '[]'::jsonb);
end $$;

create or replace function public.reminder_done_count(p_occurrence_id uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from reminder_occurrences where id = p_occurrence_id;
  if v_society is null or not public.is_admin(v_society) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  return (select count(*) from reminder_responses where occurrence_id = p_occurrence_id and response = 'done');
end $$;

create or replace function public._run_reminders(p_society uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s record; v_occ uuid; v_next date; v_count int := 0; v_users uuid[]; r record;
begin
  for s in select * from reminder_schedules
            where society_id = p_society and not is_paused and deleted_at is null and next_date <= public.ist_today()
            for update
  loop
    insert into reminder_occurrences (schedule_id, society_id, due_date) values (s.id, s.society_id, s.next_date)
    on conflict (schedule_id, due_date) do nothing returning id into v_occ;
    v_next := s.next_date;
    while v_next <= public.ist_today() loop
      v_next := public.next_reminder_date(v_next, s.interval_unit, s.interval_count);
    end loop;
    update reminder_schedules set next_date = v_next where id = s.id;
    if v_occ is not null then
      v_count := v_count + 1;
      if s.kind = 'task' then
        v_users := public._perm_user_ids(p_society, 'manage_reminders');
      else
        select array_agg(a.user_id) into v_users
          from public._audience(p_society, s.audience_type, s.audience_unit_type_ids, s.audience_unit_ids) a
         where a.unit_id is not null;
      end if;
      perform public._notify(p_society, coalesce(v_users, '{}'), 'reminder', v_occ, s.title, left(s.message, 200), '/reminders');
    end if;
  end loop;

  -- snoozed advisory reminders come back
  for r in select * from reminder_responses
            where society_id = p_society and response = 'snooze' and not snooze_notified and snooze_until <= public.ist_today()
  loop
    update reminder_responses set snooze_notified = true where id = r.id;
    perform public._notify(p_society, array[r.user_id], 'reminder', r.occurrence_id,
      (select s2.title from reminder_occurrences o join reminder_schedules s2 on s2.id = o.schedule_id where o.id = r.occurrence_id),
      'Reminder you snoozed last month', '/reminders');
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Alerts and failed logins
-- ---------------------------------------------------------------------------
create or replace function public.resolve_alert(p_alert_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid;
begin
  select society_id into v_society from alerts where id = p_alert_id;
  if v_society is null or not public.is_admin(v_society) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  update alerts set resolved_at = now(), resolved_by = auth.uid() where id = p_alert_id and resolved_at is null;
end $$;

-- Called by the login screen after a failed sign-in. Only tracks real usernames, so it cannot be used to flood alerts.
create or replace function public.report_failed_login(p_slug text, p_username text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_slug text := lower(public.clean_text(p_slug));
  v_user text := lower(public.clean_text(p_username));
  v_society uuid;
  r record;
begin
  if v_slug is null or v_user is null or char_length(v_user) > 40 or char_length(v_slug) > 41 then return; end if;
  select id into v_society from societies where slug = v_slug;
  if v_society is null then return; end if;
  if not exists (select 1 from auth.users where email = v_user || '@' || v_slug || '.local') then return; end if;

  insert into login_failures (society_slug, username, window_start, failures)
  values (v_slug, v_user, now(), 1)
  on conflict (society_slug, username) do update set
    failures = case when login_failures.window_start < now() - interval '15 minutes' then 1 else login_failures.failures + 1 end,
    alerted = case when login_failures.window_start < now() - interval '15 minutes' then false else login_failures.alerted end,
    window_start = case when login_failures.window_start < now() - interval '15 minutes' then now() else login_failures.window_start end
  returning * into r;

  if r.failures >= 5 and not r.alerted then
    update login_failures set alerted = true where society_slug = v_slug and username = v_user;
    insert into alerts (society_id, kind, title, details)
    values (v_society, 'failed_logins', format('%s failed sign-ins for %s', r.failures, upper(v_user)),
            jsonb_build_object('username', upper(v_user), 'ip', public.request_ip(), 'user_agent', public.request_user_agent()));
    perform public._notify(v_society, public._perm_user_ids(v_society, 'manage_users'), 'failed_logins', null,
      'Repeated failed sign-ins', format('Account %s had %s failed attempts in 15 minutes.', upper(v_user), r.failures), '/admin/alerts');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Public (anon) endpoints: login screen, registration, receipt verification
-- ---------------------------------------------------------------------------
create or replace function public.society_public(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'name', name, 'slug', slug) from societies where slug = lower(p_slug)
$$;

create or replace function public.registration_options(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'society', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug),
    'unit_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort_order, t.name)
                             from unit_types t where t.society_id = s.id), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', u.id, 'code', u.code, 'display_name', u.display_name, 'unit_type_id', u.unit_type_id,
                         'available', not exists (select 1 from memberships m where m.unit_id = u.id and m.status = 'active'))
                       order by u.sort_order, u.code)
                        from units u where u.society_id = s.id), '[]'::jsonb))
  from societies s where s.slug = lower(p_slug)
$$;

create or replace function public.verify_receipt(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'receipt_no', e.receipt_no, 'society', s.name, 'amount_paise', e.amount_paise, 'entry_date', e.entry_date,
    'unit_code', u.code, 'status', case when public.is_entry_reversed(e.id) then 'cancelled' else 'valid' end)
  from ledger_entries e join societies s on s.id = e.society_id left join units u on u.id = e.unit_id
  where e.receipt_token = upper(p_token) and e.receipt_no is not null
$$;

-- ---------------------------------------------------------------------------
-- Service-role helpers used by Edge Functions (never callable from the browser)
-- ---------------------------------------------------------------------------
create or replace function public._registration_check(p_slug text, p_unit_id uuid, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_society uuid; v_name text; v_phone text; v_unit record;
begin
  select id into v_society from societies where slug = lower(p_slug);
  if v_society is null then return jsonb_build_object('ok', false, 'code', 'no_society', 'message', 'Society not found.'); end if;
  v_name := public.check_person_name(p_name);
  v_phone := public.norm_phone(p_phone);
  if v_phone is null then raise exception using errcode = 'P0001', message = 'Enter a valid 10-digit Indian mobile number.'; end if;
  select * into v_unit from units where id = p_unit_id and society_id = v_society;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_unit', 'message', 'Flat not found.'); end if;
  if exists (select 1 from memberships where unit_id = v_unit.id and status = 'active') then
    insert into alerts (society_id, kind, title, details)
    values (v_society, 'duplicate_registration', format('Someone tried to register %s, which already has an account', v_unit.code),
            jsonb_build_object('unit_code', v_unit.code, 'name', v_name, 'phone', v_phone,
                               'ip', public.request_ip(), 'user_agent', public.request_user_agent()));
    perform public._notify(v_society, public._admin_ids(v_society), 'duplicate_registration', null,
      format('Duplicate registration attempt: %s', v_unit.code), format('%s (%s) tried to register this flat.', v_name, v_phone), '/admin/alerts');
    return jsonb_build_object('ok', false, 'code', 'unit_taken',
                              'message', 'This flat is already registered. The admin has been notified.');
  end if;
  if exists (select 1 from profiles where phone = v_phone) then
    return jsonb_build_object('ok', false, 'code', 'phone_taken', 'message', 'This mobile number is already registered.');
  end if;
  if (select count(*) from memberships where unit_id = v_unit.id and status = 'pending') >= 3 then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'message', 'Several registrations are already pending for this flat.');
  end if;
  return jsonb_build_object('ok', true, 'society_id', v_society, 'unit_code', v_unit.code, 'name', v_name, 'phone', v_phone);
end $$;

create or replace function public._registration_create(p_user uuid, p_society uuid, p_unit uuid, p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  insert into profiles (id, full_name, phone) values (p_user, public.check_person_name(p_name), public.norm_phone(p_phone));
  insert into memberships (user_id, society_id, unit_id, role, status) values (p_user, p_society, p_unit, 'resident', 'pending')
  returning id into v_id;
  select code into v_code from units where id = p_unit;
  insert into alerts (society_id, kind, title, details)
  values (p_society, 'registration_pending', format('New registration for %s waiting for approval', v_code),
          jsonb_build_object('membership_id', v_id, 'unit_code', v_code, 'name', p_name));
  perform public._notify(p_society, public._perm_user_ids(p_society, 'manage_users'), 'registration_pending', v_id,
    format('New registration: %s', v_code), p_name, '/admin/members');
  return v_id;
end $$;

-- Validates and (unless p_dry_run) activates a pending registration. Returns details for the Edge Function.
create or replace function public._approve_registration(p_membership_id uuid, p_approver uuid, p_replace boolean, p_dry_run boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_old record; v_slug text; v_code text;
begin
  select * into m from memberships where id = p_membership_id for update;
  if not found or m.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'Registration not found or already handled.';
  end if;
  if not public.user_has_perm(p_approver, m.society_id, 'manage_users') then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  perform public._act_as(p_approver);
  select slug into v_slug from societies where id = m.society_id;
  select code into v_code from units where id = m.unit_id;
  select * into v_old from memberships where unit_id = m.unit_id and status = 'active';
  if v_old.id is not null and not coalesce(p_replace, false) then
    raise exception using errcode = 'P0001', message = 'This flat already has an active account. Choose "replace" to deactivate it.';
  end if;
  if v_old.id is not null and v_old.role = 'super_admin' then
    raise exception using errcode = 'P0001', message = 'The existing account is a super admin and cannot be replaced here.';
  end if;
  if not coalesce(p_dry_run, false) then
    if v_old.id is not null then
      update memberships set status = 'deactivated', deactivated_at = now(),
             deactivated_reason = 'Replaced by new registration' where id = v_old.id;
      perform public._revoke_sessions(v_old.user_id, null);
    end if;
    update memberships set status = 'active', approved_by = p_approver, approved_at = now() where id = m.id;
    perform public._notify(m.society_id, array[m.user_id], 'registration_approved', m.id,
      'Welcome to Harmony Homes', 'Your registration was approved. You can now sign in with your flat code.', '/');
  end if;
  return jsonb_build_object('user_id', m.user_id, 'old_user_id', v_old.user_id, 'slug', v_slug, 'unit_code', v_code,
                            'society_id', m.society_id);
end $$;

create or replace function public._units_needing_login(p_society uuid, p_unit_ids uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'code', u.code, 'display_name', u.display_name) order by u.sort_order, u.code), '[]'::jsonb)
    from units u
   where u.society_id = p_society
     and (p_unit_ids is null or u.id = any(p_unit_ids))
     and not exists (select 1 from memberships m where m.unit_id = u.id and m.status in ('active', 'pending'))
$$;

create or replace function public._create_unit_member(p_actor uuid, p_user uuid, p_society uuid, p_unit uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  perform public._act_as(p_actor);
  if not public.user_has_perm(p_actor, p_society, 'manage_users') then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  select display_name into v_name from units where id = p_unit and society_id = p_society;
  if v_name is null then raise exception using errcode = 'P0001', message = 'Unit not found.'; end if;
  insert into profiles (id, full_name, must_change_password) values (p_user, left(v_name, 60), true)
  on conflict (id) do update set must_change_password = true;
  insert into memberships (user_id, society_id, unit_id, role, status, approved_at)
  values (p_user, p_society, p_unit, 'resident', 'active', now()) returning id into v_id;
  return v_id;
end $$;

create or replace function public._create_staff_member(p_actor uuid, p_user uuid, p_society uuid, p_name text, p_phone text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._act_as(p_actor);
  if not public.user_has_perm(p_actor, p_society, 'manage_users') then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  if p_role = 'super_admin' and coalesce(public.user_role(p_actor, p_society), '') <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only a super admin can create a super admin.';
  end if;
  if public.norm_phone(p_phone) is not null and exists (select 1 from profiles where phone = public.norm_phone(p_phone)) then
    raise exception using errcode = 'P0001', message = 'This mobile number is already used by another account.';
  end if;
  if p_role not in ('admin', 'super_admin') then raise exception using errcode = 'P0001', message = 'Invalid role.'; end if;
  insert into profiles (id, full_name, phone, must_change_password)
  values (p_user, public.check_person_name(p_name), public.norm_phone(p_phone), true);
  insert into memberships (user_id, society_id, unit_id, role, status, approved_at)
  values (p_user, p_society, null, p_role, 'active', now()) returning id into v_id;
  return v_id;
end $$;

create or replace function public._after_password_reset(p_actor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._act_as(p_actor);
  update profiles set must_change_password = true, updated_at = now() where id = p_user;
  perform public._revoke_sessions(p_user, null);
end $$;

create or replace function public._clear_must_change(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._act_as(p_user);
  update profiles set must_change_password = false, updated_at = now() where id = p_user;
end $$;

create or replace function public._member_for_admin_action(p_actor uuid, p_membership_id uuid, p_perm text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m record; v_slug text; v_code text;
begin
  select * into m from memberships where id = p_membership_id;
  if not found then raise exception using errcode = 'P0001', message = 'Member not found.'; end if;
  if not public.user_has_perm(p_actor, m.society_id, p_perm) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
  if m.role = 'super_admin' and coalesce(public.user_role(p_actor, m.society_id), '') <> 'super_admin' then
    raise exception using errcode = '42501', message = 'Only a super admin can manage a super admin.';
  end if;
  select slug into v_slug from societies where id = m.society_id;
  select code into v_code from units where id = m.unit_id;
  return jsonb_build_object('membership_id', m.id, 'user_id', m.user_id, 'society_id', m.society_id, 'slug', v_slug,
                            'unit_code', v_code, 'role', m.role, 'status', m.status);
end $$;

-- Edge functions run as the service role; record the real actor for triggers and the audit log.
create or replace function public._act_as(p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null and p_actor is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', 'service_role')::text, true);
  end if;
end $$;

create or replace function public._log_admin_action(p_actor uuid, p_society uuid, p_action text, p_details jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._act_as(p_actor);
  perform public.audit_append(p_society, p_action, 'auth', p_details ->> 'user_id', null, p_details);
end $$;

-- One-time bootstrap from the Supabase SQL editor after creating the first auth user.
create or replace function public.bootstrap_super_admin(p_email text, p_slug text, p_full_name text) returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid; v_society uuid; v_id uuid;
begin
  select id into v_user from auth.users where email = lower(p_email);
  if v_user is null then raise exception 'No auth user with email %', p_email; end if;
  select id into v_society from societies where slug = lower(p_slug);
  if v_society is null then raise exception 'No society with slug %', p_slug; end if;
  if exists (select 1 from memberships where society_id = v_society and role = 'super_admin' and status = 'active') then
    raise exception 'This society already has a super admin.';
  end if;
  insert into profiles (id, full_name, must_change_password) values (v_user, p_full_name, false)
  on conflict (id) do update set full_name = excluded.full_name;
  insert into memberships (user_id, society_id, role, status, approved_at) values (v_user, v_society, 'super_admin', 'active', now())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Daily job (pg_cron): dues on the 1st, recurring expense drafts, reminders, location retention
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0;
    begin
      if v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_drafts := public._generate_expense_drafts(s.id, v_period, true);
      if v_drafts > 0 then
        perform public._notify(s.id, public._perm_user_ids(s.id, 'record_expense'), 'expense_drafts', null,
          format('%s recurring expense(s) ready to confirm', v_drafts), 'Tap to review and confirm.', '/admin/expenses');
      end if;
      v_rem := public._run_reminders(s.id);
      update notice_receipts set ack_lat = null, ack_lng = null, ack_accuracy = null
       where society_id = s.id and ack_lat is not null
         and acknowledged_at < now() - make_interval(days => s.location_retention_days);
      get diagnostics v_purged = row_count;
    exception when others then
      v_out := v_out || jsonb_build_object('society_id', s.id, 'error', sqlerrm);
      continue;
    end;
    v_out := v_out || jsonb_build_object('society_id', s.id, 'dues', v_dues, 'drafts', v_drafts, 'reminders', v_rem, 'locations_purged', v_purged);
  end loop;
  return v_out;
end $$;
