-- Harmony Homes — (1) recurring events can fall due in the following month (e.g. due on the 7th of next month),
-- (2) estimate documents on events (several PDFs / images, add / edit / remove, everyone is told),
-- (3) society position keeps flat-type-only events apart from the overall figures.

-- ---------------------------------------------------------------------------
-- 1. Recurring events: due day in the same month or the next one
-- ---------------------------------------------------------------------------
alter table public.event_series
  add column if not exists due_month_offset int not null default 0 check (due_month_offset in (0, 1));

create or replace function public._publish_series_month(p_series uuid, p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_scope uuid[]; v_rounding bigint; v_total bigint; v_share bigint; v_id uuid; v_due date;
begin
  select * into s from event_series where id = p_series for update;
  if not found then return null; end if;
  if exists (select 1 from events where series_id = s.id and series_period = p_period) then return null; end if;
  if s.scope_type = 'all' then
    select array_agg(id order by sort_order, code) into v_scope from units where society_id = s.society_id and is_billable;
  else
    select array_agg(id order by sort_order, code) into v_scope from units
     where society_id = s.society_id and is_billable and unit_type_id = any(s.scope_unit_type_ids);
  end if;
  if coalesce(array_length(v_scope, 1), 0) = 0 then return null; end if;
  select share_rounding_paise into v_rounding from society_settings where society_id = s.society_id;
  v_total := public._series_total_for(s.id, p_period);
  v_share := public.event_share_paise(v_total, array_length(v_scope, 1), v_rounding);
  v_due := (make_date(substr(p_period, 1, 4)::int, substr(p_period, 6, 2)::int, s.due_day) + make_interval(months => s.due_month_offset))::date;
  if s.due_month_offset = 0 then v_due := greatest(v_due, public.ist_today()); end if;
  insert into events (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, rounding_paise,
                      in_scope_count, expected_count, per_unit_share_paise, due_date, created_by, series_id, series_period)
  values (s.society_id, s.title || ' – ' || public._period_label(p_period), s.description, s.scope_type, s.scope_unit_type_ids,
          v_total, v_rounding, array_length(v_scope, 1), array_length(v_scope, 1), v_share, v_due, s.created_by, s.id, p_period)
  returning id into v_id;
  insert into event_units (event_id, unit_id, society_id, expected) select v_id, x, s.society_id, true from unnest(v_scope) x;
  perform public._open_event(v_id);
  return v_id;
end $$;
revoke execute on function public._publish_series_month(uuid, text) from public, anon, authenticated;

drop function if exists public.create_event_series(uuid, text, text, bigint, text, uuid[], int, boolean);
create or replace function public.create_event_series(
  p_society uuid, p_title text, p_description text, p_total_cost_paise bigint, p_scope_type text,
  p_unit_type_ids uuid[] default '{}', p_due_day int default 10, p_publish_now boolean default true,
  p_due_month_offset int default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_title text := public.clean_text(p_title); v_id uuid; v_cur text := public.period_of(public.ist_today());
begin
  perform public.assert_perm(p_society, 'manage_events');
  if char_length(coalesce(v_title, '')) < 3 or char_length(v_title) > 80 then
    raise exception using errcode = 'P0001', message = 'Name must be 3 to 80 characters.';
  end if;
  perform public._check_amount(p_total_cost_paise);
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Due day must be between 1 and 28.';
  end if;
  if p_due_month_offset is null or p_due_month_offset not in (0, 1) then
    raise exception using errcode = 'P0001', message = 'Choose whether it is due in the same month or the next month.';
  end if;
  if p_scope_type = 'unit_types' then
    if coalesce(array_length(p_unit_type_ids, 1), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'Pick at least one flat type.';
    end if;
    if exists (select 1 from unnest(p_unit_type_ids) t where t not in (select id from unit_types where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat type.';
    end if;
  elsif p_scope_type <> 'all' then
    raise exception using errcode = 'P0001', message = 'Choose who this applies to.';
  end if;
  insert into event_series (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, due_day, due_month_offset, created_by)
  values (p_society, v_title, left(public.clean_body(p_description), 2000), p_scope_type,
          case when p_scope_type = 'unit_types' then p_unit_type_ids else '{}' end, p_total_cost_paise, p_due_day, p_due_month_offset, auth.uid())
  returning id into v_id;
  insert into event_series_versions (society_id, series_id, total_cost_paise, effective_period, reason, changed_by)
  values (p_society, v_id, p_total_cost_paise, v_cur, 'Started', auth.uid());
  perform public._notify(p_society, public._all_member_ids(p_society), 'series_change', v_id,
    format('New monthly collection: %s', v_title),
    format('%s a month, shared by the flats. A new event is published on the 1st of every month.', public.fmt_inr(p_total_cost_paise)), '/events');
  if coalesce(p_publish_now, true) then perform public._publish_series_month(v_id, v_cur); end if;
  return v_id;
end $$;
grant execute on function public.create_event_series(uuid, text, text, bigint, text, uuid[], int, boolean, int) to authenticated;

drop function if exists public.update_event_series(uuid, text, text, int, boolean);
create or replace function public.update_event_series(p_series uuid, p_title text, p_description text, p_due_day int, p_is_active boolean, p_due_month_offset int default null) returns void
language plpgsql security definer set search_path = public as $$
declare s record; v_title text := public.clean_text(p_title); v_off int;
begin
  select * into s from event_series where id = p_series for update;
  if not found then raise exception using errcode = 'P0001', message = 'Recurring event not found.'; end if;
  perform public.assert_perm(s.society_id, 'manage_events');
  if char_length(coalesce(v_title, '')) < 3 or char_length(v_title) > 80 then
    raise exception using errcode = 'P0001', message = 'Name must be 3 to 80 characters.';
  end if;
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Due day must be between 1 and 28.';
  end if;
  v_off := coalesce(p_due_month_offset, s.due_month_offset);
  if v_off not in (0, 1) then raise exception using errcode = 'P0001', message = 'Choose whether it is due in the same month or the next month.'; end if;
  update event_series set title = v_title, description = left(public.clean_body(p_description), 2000),
         due_day = p_due_day, due_month_offset = v_off, is_active = coalesce(p_is_active, true) where id = s.id;
  if s.title is distinct from v_title or s.due_day <> p_due_day or s.due_month_offset <> v_off or s.is_active <> coalesce(p_is_active, true) then
    perform public._notify(s.society_id, public._all_member_ids(s.society_id), 'series_change', s.id,
      format('Recurring collection updated: %s', v_title),
      case when s.is_active and not coalesce(p_is_active, true) then 'It will no longer be published automatically each month.'
           when not s.is_active and coalesce(p_is_active, true) then 'It will be published automatically on the 1st of every month.'
           else format('Due by day %s of the %s month. Earlier months are not affected.', p_due_day, case when v_off = 1 then 'next' else 'same' end) end, '/events');
  end if;
end $$;
grant execute on function public.update_event_series(uuid, text, text, int, boolean, int) to authenticated;

-- recurring_overview also reports due_month_offset
create or replace function public.recurring_overview(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := public.period_of(public.ist_today());
begin
  perform public.assert_member(p_society);
  return jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'description', s.description, 'scope_type', s.scope_type, 'due_day', s.due_day,
        'due_month_offset', s.due_month_offset,
        'is_active', s.is_active, 'total_cost_paise', s.total_cost_paise,
        'pending_total_paise', s.pending_total_paise, 'pending_from_period', s.pending_from_period,
        'this_month_event_id', (select e.id from events e where e.series_id = s.id and e.series_period = v_cur),
        'history', coalesce((select jsonb_agg(jsonb_build_object('amount_paise', v.total_cost_paise, 'from', v.effective_period,
                    'reason', v.reason, 'at', v.changed_at) order by v.changed_at desc)
                   from event_series_versions v where v.series_id = s.id), '[]'::jsonb)) order by s.created_at)
       from event_series s where s.society_id = p_society), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'day_of_month', t.day_of_month, 'is_active', t.is_active, 'amount_paise', t.amount_paise,
        'pending_amount_paise', t.pending_amount_paise, 'pending_from_period', t.pending_from_period,
        'history', coalesce((select jsonb_agg(jsonb_build_object('amount_paise', v.amount_paise, 'from', v.effective_period,
                    'reason', v.reason, 'at', v.changed_at) order by v.changed_at desc)
                   from expense_template_versions v where v.template_id = t.id), '[]'::jsonb)) order by t.day_of_month)
       from expense_templates t where t.society_id = p_society), '[]'::jsonb));
end $$;
grant execute on function public.recurring_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Estimate / supporting documents on an event
-- ---------------------------------------------------------------------------
create table if not exists public.event_documents (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  note text check (note is null or char_length(note) <= 500),
  file_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles(id)
);
create index if not exists event_documents_event_idx on public.event_documents(event_id, created_at) where removed_at is null;

alter table public.event_documents enable row level security;
create policy evdoc_read on public.event_documents for select to authenticated using (public.is_member(society_id) and removed_at is null);
revoke all on public.event_documents from anon;
grant select on public.event_documents to authenticated;
create trigger audit_event_documents after insert or update or delete on public.event_documents
  for each row execute function public.audit_trigger();
create trigger zz_view_only_guard before insert or update or delete on public.event_documents
  for each statement execute function public.block_view_only_writes();

-- storage: files live under {society}/events/{event_id}/…  (read: any member, already allowed; write: event managers)
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
  elsif v_kind = 'events' then
    return public.has_perm(v_society, 'manage_events')
       and exists (select 1 from events where id = public.try_uuid(v_owner) and society_id = v_society);
  end if;
  return false;
end $$;

create or replace function public.add_event_documents(p_event_id uuid, p_docs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare ev record; d jsonb; v_n int := 0; v_title text; v_path text; v_total int; v_names text := '';
begin
  select * into ev from events where id = p_event_id;
  if not found then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_perm(ev.society_id, 'manage_events');
  if jsonb_typeof(p_docs) <> 'array' or jsonb_array_length(p_docs) = 0 then
    raise exception using errcode = 'P0001', message = 'Choose at least one file.';
  end if;
  select count(*) into v_total from event_documents where event_id = ev.id and removed_at is null;
  if v_total + jsonb_array_length(p_docs) > 30 then
    raise exception using errcode = 'P0001', message = 'An event can have at most 30 documents.';
  end if;
  for d in select * from jsonb_array_elements(p_docs) loop
    v_title := public.clean_text(d ->> 'title');
    v_path := d ->> 'path';
    if char_length(coalesce(v_title, '')) < 2 then
      raise exception using errcode = 'P0001', message = 'Give every document a name.';
    end if;
    if v_path is null or v_path not like ev.society_id::text || '/events/' || ev.id::text || '/%' then
      raise exception using errcode = 'P0001', message = 'Invalid file.';
    end if;
    insert into event_documents (society_id, event_id, title, note, file_path, mime_type, size_bytes, created_by)
    values (ev.society_id, ev.id, left(v_title, 120), left(public.clean_text(d ->> 'note'), 500), v_path,
            left(d ->> 'mime', 80), nullif(d ->> 'size', '')::bigint, auth.uid());
    v_n := v_n + 1;
    v_names := v_names || case when v_n <= 3 then (case when v_n > 1 then ', ' else '' end) || v_title else '' end;
  end loop;
  perform public._notify(ev.society_id, public._all_member_ids(ev.society_id), 'event_document', ev.id,
    format('%s: %s added', ev.title, case when v_n = 1 then 'new document' else v_n || ' new documents' end),
    v_names || case when v_n > 3 then format(' and %s more', v_n - 3) else '' end, '/events/' || ev.id);
  return v_n;
end $$;
grant execute on function public.add_event_documents(uuid, jsonb) to authenticated;

create or replace function public.update_event_document(p_doc_id uuid, p_title text, p_note text, p_file_path text default null, p_mime text default null, p_size bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare d record; ev record; v_title text := public.clean_text(p_title);
begin
  select * into d from event_documents where id = p_doc_id and removed_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'Document not found.'; end if;
  select * into ev from events where id = d.event_id;
  perform public.assert_perm(d.society_id, 'manage_events');
  if char_length(coalesce(v_title, '')) < 2 then
    raise exception using errcode = 'P0001', message = 'Give the document a name.';
  end if;
  if p_file_path is not null and p_file_path not like d.society_id::text || '/events/' || d.event_id::text || '/%' then
    raise exception using errcode = 'P0001', message = 'Invalid file.';
  end if;
  update event_documents set title = left(v_title, 120), note = left(public.clean_text(p_note), 500),
         file_path = coalesce(p_file_path, file_path), mime_type = case when p_file_path is null then mime_type else left(p_mime, 80) end,
         size_bytes = case when p_file_path is null then size_bytes else p_size end,
         updated_by = auth.uid(), updated_at = now()
   where id = d.id;
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'event_document', d.event_id,
    format('%s: document updated', ev.title),
    case when p_file_path is not null then format('“%s” was replaced with a new file.', v_title) else format('“%s” was edited.', v_title) end,
    '/events/' || d.event_id);
end $$;
grant execute on function public.update_event_document(uuid, text, text, text, text, bigint) to authenticated;

create or replace function public.remove_event_document(p_doc_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d record; ev record;
begin
  select * into d from event_documents where id = p_doc_id and removed_at is null for update;
  if not found then raise exception using errcode = 'P0001', message = 'Document not found.'; end if;
  select * into ev from events where id = d.event_id;
  perform public.assert_perm(d.society_id, 'manage_events');
  -- soft removal: the row (and the stored file) stay for the audit trail, members just stop seeing it
  update event_documents set removed_at = now(), removed_by = auth.uid() where id = d.id;
  perform public._notify(d.society_id, public._all_member_ids(d.society_id), 'event_document', d.event_id,
    format('%s: document removed', ev.title), format('“%s” was removed.', d.title), '/events/' || d.event_id);
end $$;
grant execute on function public.remove_event_document(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Society position: flat-type-only events stay apart from the overall figures
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
      'scope_label', case when ev.id is null or ev.scope_type = 'all' then null
                          when ev.scope_type = 'unit_types' then (select string_agg(ut.name, ' + ' order by ut.name) from unit_types ut where ut.id = any(ev.scope_unit_type_ids))
                          else 'Selected flats' end,
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
    from funds f left join events ev on ev.id = f.event_id
   where f.society_id = p_society
     and (f.kind = 'general' or ev.status = 'open'
          or public.fund_balance_paise(f.id) <> 0
          or exists (select 1 from dues d where d.fund_id = f.id and not d.waived and d.amount_paise > public.due_paid_paise(d.id)))
  ) t;
  return jsonb_build_object(
    'funds', v_funds,
    -- overall = General + events that apply to every flat; flat-type-only events are reported separately
    'totals', jsonb_build_object(
      'balance_paise', (select coalesce(sum((x ->> 'balance_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'pending_paise', (select coalesce(sum((x ->> 'pending_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'overdue_paise', (select coalesce(sum((x ->> 'overdue_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null),
      'advance_paise', (select coalesce(sum((x ->> 'advance_paise')::bigint), 0) from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is null)),
    'scoped', coalesce((select jsonb_agg(jsonb_build_object('label', l,
        'balance_paise', b, 'pending_paise', p, 'advance_paise', a) order by l)
      from (select x ->> 'scope_label' as l, sum((x ->> 'balance_paise')::bigint) as b,
                   sum((x ->> 'pending_paise')::bigint) as p, sum((x ->> 'advance_paise')::bigint) as a
              from jsonb_array_elements(v_funds) x where x ->> 'scope_label' is not null group by 1) g), '[]'::jsonb));
end $$;
grant execute on function public.society_position(uuid) to authenticated;
