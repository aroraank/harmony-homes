-- Harmony Homes — append-only, hash-chained audit log written by triggers.
-- Each society has its own chain (rows with a null society form one extra chain).

create or replace function public.audit_row_hash(
  p_prev text, p_id bigint, p_society uuid, p_actor uuid, p_action text, p_table text,
  p_row_id text, p_before jsonb, p_after jsonb, p_ip text, p_ua text, p_created timestamptz
) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(
    coalesce(p_prev, '') || '|' || p_id::text || '|' || coalesce(p_society::text, '') || '|' ||
    coalesce(p_actor::text, '') || '|' || p_action || '|' || p_table || '|' || coalesce(p_row_id, '') || '|' ||
    coalesce(p_before::text, '') || '|' || coalesce(p_after::text, '') || '|' ||
    coalesce(p_ip, '') || '|' || coalesce(p_ua, '') || '|' ||
    to_char(p_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex')
$$;

-- Internal: append one audit row (also used for non-table events such as month reopen)
create or replace function public.audit_append(
  p_society uuid, p_action text, p_table text, p_row_id text, p_before jsonb, p_after jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_prev text;
  v_id bigint;
  v_created timestamptz := clock_timestamp();
  v_actor uuid := auth.uid();
  v_ip text := public.request_ip();
  v_ua text := public.request_user_agent();
begin
  -- serialise appends per chain so prev_hash is always the true predecessor
  perform pg_advisory_xact_lock(hashtextextended('hh_audit:' || coalesce(p_society::text, 'global'), 0));
  select row_hash into v_prev from audit_log
   where society_id is not distinct from p_society
   order by id desc limit 1;
  v_id := nextval(pg_get_serial_sequence('public.audit_log', 'id'));
  insert into audit_log (id, society_id, actor_id, action, table_name, row_id, before, after, ip, user_agent, created_at, prev_hash, row_hash)
  values (v_id, p_society, v_actor, p_action, p_table, p_row_id, p_before, p_after, v_ip, v_ua, v_created, v_prev,
          public.audit_row_hash(v_prev, v_id, p_society, v_actor, p_action, p_table, p_row_id, p_before, p_after, v_ip, v_ua, v_created));
end $$;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_society uuid;
  v_row_id text;
  k text;
begin
  if TG_OP in ('UPDATE', 'DELETE') then v_before := to_jsonb(OLD); end if;
  if TG_OP in ('INSERT', 'UPDATE') then v_after := to_jsonb(NEW); end if;

  -- strip columns that must not be retained in the permanent log (e.g. location)
  if TG_NARGS > 0 then
    foreach k in array TG_ARGV loop
      v_before := v_before - k;
      v_after := v_after - k;
    end loop;
  end if;

  if TG_OP = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_row := coalesce(v_after, v_before);
  if TG_TABLE_NAME = 'societies' then
    v_society := (v_row ->> 'id')::uuid;
  elsif v_row ? 'society_id' then
    v_society := (v_row ->> 'society_id')::uuid;
  elsif TG_TABLE_NAME = 'profiles' then
    select m.society_id into v_society from memberships m
     where m.user_id = (v_row ->> 'id')::uuid order by m.created_at limit 1;
  end if;

  v_row_id := coalesce(v_row ->> 'id', v_row ->> 'society_id');
  if TG_TABLE_NAME = 'role_permissions' then
    v_row_id := (v_row ->> 'role') || ':' || (v_row ->> 'permission');
  end if;

  perform public.audit_append(v_society, lower(TG_OP), TG_TABLE_NAME, v_row_id, v_before, v_after);
  return null;
end $$;

-- Attach to every business table
do $$
declare t text;
begin
  foreach t in array array[
    'societies','society_settings','unit_types','blocks','floors','units','profiles','memberships',
    'role_permissions','funds','expense_categories','events','event_units','ledger_entries','dues',
    'due_allocations','month_closings','payment_claims','expense_templates','expense_drafts',
    'notices','alerts','concerns','concern_messages','contact_categories','contacts',
    'reminder_schedules','reminder_task_logs']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- Location is personal data that can be purged later, so it is never copied into the audit log.
create trigger audit_notice_receipts after insert or update or delete on public.notice_receipts
  for each row execute function public.audit_trigger('ack_lat', 'ack_lng', 'ack_accuracy');

-- The audit log itself is append-only.
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.forbid_mutation();

-- Super admin: verify the chain of their society
create or replace function public.verify_audit_chain(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r record;
  v_prev text := null;
  v_count bigint := 0;
  v_expected text;
begin
  perform public.assert_super_admin(p_society);
  for r in select * from audit_log where society_id = p_society order by id loop
    v_count := v_count + 1;
    if r.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'checked', v_count, 'broken_at', r.id, 'reason', 'prev_hash mismatch');
    end if;
    v_expected := public.audit_row_hash(r.prev_hash, r.id, r.society_id, r.actor_id, r.action, r.table_name,
                                        r.row_id, r.before, r.after, r.ip, r.user_agent, r.created_at);
    if v_expected <> r.row_hash then
      return jsonb_build_object('ok', false, 'checked', v_count, 'broken_at', r.id, 'reason', 'row_hash mismatch');
    end if;
    v_prev := r.row_hash;
  end loop;
  return jsonb_build_object('ok', true, 'checked', v_count, 'head', v_prev);
end $$;
