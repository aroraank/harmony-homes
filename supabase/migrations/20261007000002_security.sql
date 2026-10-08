-- Harmony Homes — roles, permissions, RLS, grants, immutability

-- ---------------------------------------------------------------------------
-- Permission catalogue. Super admin always has everything.
-- Admin defaults below can be toggled per society in role_permissions.
-- ---------------------------------------------------------------------------
create or replace function public.permission_catalogue() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'record_payment', 'record_expense', 'approve_claims', 'reverse_entry',
    'manage_events', 'generate_dues', 'close_month', 'reopen_month',
    'send_notices', 'manage_units', 'manage_users', 'manage_settings',
    'view_audit_all', 'manage_contacts', 'manage_reminders', 'manage_concerns',
    'record_adjustment'
  ]
$$;

create or replace function public.default_permission(p_role text, p_perm text) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_role = 'super_admin' then true
    when p_role = 'admin' then p_perm in (
      'record_payment', 'record_expense', 'approve_claims', 'reverse_entry',
      'manage_events', 'generate_dues', 'close_month', 'send_notices',
      'manage_contacts', 'manage_reminders', 'manage_concerns')
    else false
  end
$$;

-- Role of a given user in a society (active membership only; blocked until first password change)
create or replace function public.user_role(p_user uuid, p_society uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
  from memberships m
  join profiles p on p.id = m.user_id
  where m.user_id = p_user
    and m.society_id = p_society
    and m.status = 'active'
    and not p.must_change_password
  order by case m.role when 'super_admin' then 1 when 'admin' then 2 else 3 end
  limit 1
$$;

create or replace function public.my_role(p_society uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.user_role(auth.uid(), p_society)
$$;

create or replace function public.is_member(p_society uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role(p_society) is not null
$$;

create or replace function public.is_admin(p_society uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_society) in ('admin', 'super_admin'), false)
$$;

create or replace function public.is_super_admin(p_society uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_society) = 'super_admin', false)
$$;

create or replace function public.user_has_perm(p_user uuid, p_society uuid, p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.user_role(p_user, p_society);
  v_allowed boolean;
begin
  if v_role is null then return false; end if;
  if v_role = 'super_admin' then return true; end if;
  select allowed into v_allowed from role_permissions
   where society_id = p_society and role = v_role and permission = p_perm;
  return coalesce(v_allowed, public.default_permission(v_role, p_perm));
end $$;

create or replace function public.has_perm(p_society uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.user_has_perm(auth.uid(), p_society, p_perm)
$$;

create or replace function public.my_unit_ids(p_society uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.unit_id from memberships m join profiles p on p.id = m.user_id
   where m.user_id = auth.uid() and m.society_id = p_society and m.status = 'active'
     and m.unit_id is not null and not p.must_change_password
$$;

-- Raise helpers (used by every RPC)
create or replace function public.assert_member(p_society uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in again.';
  end if;
  v_role := public.my_role(p_society);
  if v_role is null then
    raise exception using errcode = '42501', message = 'You are not an active member of this society.';
  end if;
  return v_role;
end $$;

create or replace function public.assert_perm(p_society uuid, p_perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if not public.has_perm(p_society, p_perm) then
    raise exception using errcode = '42501', message = 'You do not have permission to do this.';
  end if;
end $$;

create or replace function public.assert_super_admin(p_society uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if not public.is_super_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only the super admin can do this.';
  end if;
end $$;

-- Request metadata (PostgREST exposes request headers as a GUC)
create or replace function public.request_ip() returns text
language plpgsql stable set search_path = public as $$
declare h jsonb; v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then return null;
  end;
  if h is null then return null; end if;
  v := coalesce(h ->> 'cf-connecting-ip', split_part(h ->> 'x-forwarded-for', ',', 1), h ->> 'x-real-ip');
  return nullif(btrim(v), '');
end $$;

create or replace function public.request_user_agent() returns text
language plpgsql stable set search_path = public as $$
declare h jsonb;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then return null;
  end;
  return left(h ->> 'user-agent', 400);
end $$;

-- ---------------------------------------------------------------------------
-- Immutability: ledger entries and allocations can never be updated or deleted.
-- ---------------------------------------------------------------------------
create or replace function public.forbid_mutation() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception using errcode = '42501',
    message = format('%s rows are immutable. Use a reversal entry instead.', TG_TABLE_NAME);
end $$;

create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function public.forbid_mutation();
create trigger due_allocations_immutable before update or delete on public.due_allocations
  for each row execute function public.forbid_mutation();
create trigger ledger_entries_no_truncate before truncate on public.ledger_entries
  for each statement execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Grants: clients may only SELECT (filtered by RLS). Every write goes through
-- security definer RPCs. anon gets nothing on tables.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

-- Tables that are never readable directly by clients
revoke select on public.receipt_counters, public.login_failures from authenticated;
revoke select on public.concerns, public.concern_messages, public.concern_reads from authenticated;
revoke select on public.push_subscriptions from authenticated;

-- Defence in depth, even for service_role / owners
revoke update, delete, truncate on public.ledger_entries, public.due_allocations, public.audit_log from authenticated, anon, service_role;

-- Future tables/functions created by migrations must not be auto-exposed
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, public;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'societies','society_settings','unit_types','blocks','floors','units','profiles','memberships',
    'role_permissions','funds','expense_categories','events','event_units','ledger_entries','dues',
    'due_allocations','month_closings','receipt_counters','payment_claims','expense_templates',
    'expense_drafts','notices','notice_receipts','push_subscriptions','notifications','audit_log',
    'alerts','login_failures','concerns','concern_messages','concern_reads','contact_categories',
    'contacts','reminder_schedules','reminder_occurrences','reminder_responses','reminder_task_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Society-scoped "any active member can read" tables
do $$
declare t text;
begin
  foreach t in array array[
    'society_settings','unit_types','blocks','floors','units','role_permissions','funds',
    'expense_categories','events','event_units','ledger_entries','dues','due_allocations',
    'month_closings','expense_templates','contact_categories','reminder_occurrences','reminder_task_logs']
  loop
    execute format('create policy member_read on public.%I for select to authenticated using (public.is_member(society_id))', t);
  end loop;
end $$;

create policy member_read on public.societies for select to authenticated
  using (public.is_member(id));

-- Own profile always; admins see members of their societies; everyone sees admins' names
create policy profile_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists (
    select 1 from public.memberships m
     where m.user_id = profiles.id
       and (public.is_admin(m.society_id)
            or (m.role in ('admin', 'super_admin') and m.status = 'active' and public.is_member(m.society_id)))
  )
);

create policy membership_read on public.memberships for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin(society_id)
  or (role in ('admin', 'super_admin') and status = 'active' and public.is_member(society_id))
);

create policy claim_read on public.payment_claims for select to authenticated using (
  public.is_admin(society_id)
  or (submitted_by = auth.uid() and public.is_member(society_id))
  or unit_id in (select public.my_unit_ids(society_id))
);

create policy draft_read on public.expense_drafts for select to authenticated
  using (public.is_admin(society_id));

create policy notice_read on public.notices for select to authenticated using (
  public.is_admin(society_id)
  or (public.is_member(society_id) and exists (
        select 1 from public.notice_receipts r where r.notice_id = notices.id and r.user_id = auth.uid()))
);

create policy notice_receipt_read on public.notice_receipts for select to authenticated using (
  (user_id = auth.uid() and public.is_member(society_id)) or public.is_admin(society_id)
);

create policy push_sub_own on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

create policy notification_own on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy audit_read on public.audit_log for select to authenticated using (
  public.is_super_admin(society_id)
  or public.has_perm(society_id, 'view_audit_all')
  or (actor_id = auth.uid() and public.is_admin(society_id))
);

create policy alert_read on public.alerts for select to authenticated
  using (public.is_admin(society_id));

-- Concerns: raiser + admins only (direct reads are revoked anyway; views below enforce the same)
create policy concern_read on public.concerns for select to authenticated
  using (raised_by = auth.uid() or public.is_admin(society_id));
create policy concern_msg_read on public.concern_messages for select to authenticated using (
  exists (select 1 from public.concerns c where c.id = concern_messages.concern_id
           and (c.raised_by = auth.uid() or public.is_admin(c.society_id)))
);
create policy concern_reads_own on public.concern_reads for select to authenticated
  using (user_id = auth.uid());

create policy contact_read on public.contacts for select to authenticated using (
  public.is_member(society_id)
  and (status = 'active' or added_by = auth.uid() or public.is_admin(society_id))
);

create policy reminder_read on public.reminder_schedules for select to authenticated
  using (public.is_member(society_id) and (deleted_at is null or public.is_admin(society_id)));

create policy reminder_resp_own on public.reminder_responses for select to authenticated
  using (user_id = auth.uid() and public.is_member(society_id));

-- receipt_counters, login_failures: no policies => no access for clients.
