-- Harmony Homes — storage bucket + policies, society onboarding helper, function grants

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: one private bucket, files under {society_id}/{kind}/...
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_society uuid := public.try_uuid(v_parts[1]);
  v_kind text := v_parts[2];
  v_owner text := v_parts[3];
begin
  if v_society is null or array_length(v_parts, 1) < 3 or not public.is_member(v_society) then
    return false;
  end if;
  if v_kind = 'claims' then
    return v_owner = auth.uid()::text or public.is_admin(v_society);
  elsif v_kind = 'concerns' then
    if v_owner like 'new-%' then
      return v_owner = 'new-' || auth.uid()::text or public.is_admin(v_society);
    end if;
    return public.can_view_concern(public.try_uuid(v_owner));
  elsif v_kind in ('ledger', 'notices', 'settings', 'events') then
    return true;
  end if;
  return false;
end $$;

create or replace function public.can_write_object(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_society uuid := public.try_uuid(v_parts[1]);
  v_kind text := v_parts[2];
  v_owner text := v_parts[3];
begin
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

drop policy if exists hh_read on storage.objects;
drop policy if exists hh_insert on storage.objects;
create policy hh_read on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.can_read_object(name));
create policy hh_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_write_object(name));
-- No update/delete policies: uploaded evidence (bills, screenshots) is never overwritten or removed.

-- ---------------------------------------------------------------------------
-- Society onboarding (run from the SQL editor / seed; not exposed to clients)
-- ---------------------------------------------------------------------------
create or replace function public.create_society(p_name text, p_slug text, p_start_month text, p_monthly_due_paise bigint default 80000)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into societies (name, slug) values (p_name, lower(p_slug)) returning id into v_id;
  insert into society_settings (society_id, start_month, monthly_due_paise) values (v_id, p_start_month, p_monthly_due_paise);
  insert into funds (society_id, name, kind) values (v_id, 'General', 'general');
  insert into expense_categories (society_id, code, label, is_system, sort_order) values
    (v_id, 'salary', 'Security salary', true, 1),
    (v_id, 'electricity', 'Electricity', true, 2),
    (v_id, 'water', 'Water', true, 3),
    (v_id, 'repair', 'Repair', true, 4),
    (v_id, 'cleaning', 'Cleaning', true, 5),
    (v_id, 'other', 'Other', true, 99);
  insert into contact_categories (society_id, name, sort_order, is_pinned) values
    (v_id, 'Security guard', 1, true), (v_id, 'Admins / committee', 2, true), (v_id, 'Plumber', 10, false),
    (v_id, 'Electrician', 11, false), (v_id, 'Motor repair', 12, false), (v_id, 'Tank cleaning', 13, false),
    (v_id, 'Carpenter', 14, false), (v_id, 'RO / water', 15, false), (v_id, 'Gas', 16, false),
    (v_id, 'Pest control', 17, false), (v_id, 'Other', 99, false);
  insert into reminder_schedules (society_id, title, message, interval_unit, interval_count, next_date, audience_type,
                                  contact_category_id, kind)
  select v_id, 'Tank cleaning', 'It has been about 6 months. Consider getting your water tank cleaned. Contacts are in the directory.',
         'months', 6, (date_trunc('month', public.ist_today()) + interval '1 month')::date, 'all', c.id, 'advisory'
    from contact_categories c where c.society_id = v_id and c.name = 'Tank cleaning';
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Function grants: nothing is executable by default; expose the public API explicitly.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname not like '\_%'
       and p.proname not in ('audit_append', 'audit_trigger', 'forbid_mutation', 'bootstrap_super_admin', 'run_daily_jobs',
                             'create_society', 'user_role', 'user_has_perm', 'audit_row_hash')
  loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- Public endpoints for the login, registration and receipt-verify screens
grant execute on function public.society_public(text) to anon;
grant execute on function public.registration_options(text) to anon;
grant execute on function public.verify_receipt(text) to anon;
grant execute on function public.report_failed_login(text, text) to anon;
-- helpers referenced by the anon functions above run as definer; nothing else for anon.

grant execute on all functions in schema public to service_role;
