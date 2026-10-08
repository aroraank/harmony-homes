-- Harmony Homes — meetings: admin calls a meeting for all flats, a flat-type audience
-- (2BHK/3BHK/etc), or a hand-picked set of flats, with a reorderable agenda checklist.
-- Everyone in the society sees it and the home page shows the next one; the notice makes
-- clear who is actually expected to attend.

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 140),
  description text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  scope_type text not null default 'all' check (scope_type in ('all', 'unit_types', 'custom')),
  scope_unit_type_ids uuid[] not null default '{}',
  scope_unit_ids uuid[] not null default '{}',
  meeting_date date not null,
  start_time time not null,
  location text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meetings_society_date_idx on public.meetings (society_id, status, meeting_date, start_time);

create table public.meeting_agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  position int not null,
  text text not null check (char_length(text) between 1 and 300)
);
create index meeting_agenda_items_meeting_idx on public.meeting_agenda_items (meeting_id, position);

-- extend the permission catalogue
create or replace function public.permission_catalogue() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'record_payment', 'record_expense', 'approve_claims', 'reverse_entry',
    'manage_events', 'generate_dues', 'close_month', 'reopen_month',
    'send_notices', 'manage_units', 'manage_users', 'manage_settings',
    'view_audit_all', 'manage_contacts', 'manage_reminders', 'manage_concerns',
    'record_adjustment', 'manage_meetings'
  ]
$$;

create or replace function public.default_permission(p_role text, p_perm text) returns boolean
language sql immutable set search_path = public as $$
  select case
    when p_role = 'super_admin' then true
    when p_role = 'admin' then p_perm in (
      'record_payment', 'record_expense', 'approve_claims', 'reverse_entry',
      'manage_events', 'generate_dues', 'close_month', 'send_notices',
      'manage_contacts', 'manage_reminders', 'manage_concerns', 'manage_meetings')
    else false
  end
$$;

alter table public.meetings enable row level security;
alter table public.meeting_agenda_items enable row level security;

create policy meeting_read on public.meetings for select to authenticated using (
  public.is_admin(society_id) or (status = 'published' and public.is_member(society_id))
);
create policy meeting_agenda_read on public.meeting_agenda_items for select to authenticated using (
  exists (select 1 from public.meetings mt where mt.id = meeting_agenda_items.meeting_id
            and (public.is_admin(mt.society_id) or (mt.status = 'published' and public.is_member(mt.society_id))))
);

create trigger audit_meetings after insert or update or delete on public.meetings
  for each row execute function public.audit_trigger();

revoke select on public.meetings, public.meeting_agenda_items from anon;
grant select on public.meetings, public.meeting_agenda_items to authenticated;

-- A human label for who is expected ("All flats", "2BHK, 3BHK", "4 flats")
create or replace function public._meeting_audience_label(p_meeting_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case mt.scope_type
    when 'all' then 'All flats'
    when 'unit_types' then coalesce((select array_to_string(array_agg(ut.name order by ut.sort_order), ', ')
                                        from unit_types ut where ut.id = any(mt.scope_unit_type_ids)), 'Selected flat types')
    else coalesce(array_length(mt.scope_unit_ids, 1), 0)::text || ' flat' ||
         (case when coalesce(array_length(mt.scope_unit_ids, 1), 0) = 1 then '' else 's' end)
  end
  from meetings mt where mt.id = p_meeting_id
$$;

create or replace view public.v_meetings with (security_invoker = true) as
select
  mt.id, mt.society_id, mt.title, mt.description, mt.status, mt.scope_type,
  mt.scope_unit_type_ids, mt.scope_unit_ids, mt.meeting_date, mt.start_time, mt.location,
  mt.created_by, mt.published_at, mt.created_at, mt.updated_at,
  public._meeting_audience_label(mt.id) as audience_label,
  coalesce((select jsonb_agg(jsonb_build_object('id', ai.id, 'text', ai.text) order by ai.position)
              from meeting_agenda_items ai where ai.meeting_id = mt.id), '[]'::jsonb) as agenda,
  p.full_name as created_by_name
from meetings mt
left join profiles p on p.id = mt.created_by;

revoke all on public.v_meetings from anon, authenticated;
grant select on public.v_meetings to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public._resolve_meeting_scope(
  p_society uuid, p_scope_type text, p_unit_type_ids uuid[], p_unit_ids uuid[]
) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_scope_type = 'unit_types' then
    if coalesce(array_length(p_unit_type_ids, 1), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'Pick at least one flat type.';
    end if;
    if exists (select 1 from unnest(p_unit_type_ids) t where t not in (select id from unit_types where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat type.';
    end if;
  elsif p_scope_type = 'custom' then
    if coalesce(array_length(p_unit_ids, 1), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'Pick at least one flat.';
    end if;
    if exists (select 1 from unnest(p_unit_ids) t where t not in (select id from units where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat in selection.';
    end if;
  elsif p_scope_type <> 'all' then
    raise exception using errcode = 'P0001', message = 'Choose who this meeting is for.';
  end if;
end $$;

create or replace function public._meeting_scope_user_ids(
  p_society uuid, p_scope_type text, p_unit_type_ids uuid[], p_unit_ids uuid[]
) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
    from memberships m
    where m.society_id = p_society and m.status = 'active'
      and (
        p_scope_type = 'all'
        or (p_scope_type = 'unit_types' and m.unit_id in (select id from units where society_id = p_society and unit_type_id = any(p_unit_type_ids)))
        or (p_scope_type = 'custom' and m.unit_id = any(p_unit_ids))
      )
$$;

create or replace function public.create_meeting(
  p_society uuid,
  p_title text,
  p_description text,
  p_meeting_date date,
  p_start_time time,
  p_location text,
  p_scope_type text default 'all',
  p_unit_type_ids uuid[] default '{}',
  p_unit_ids uuid[] default '{}',
  p_agenda text[] default '{}',
  p_publish boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_title text := public.clean_text(p_title);
  v_id uuid;
  v_item text;
  v_pos int := 0;
begin
  perform public.assert_perm(p_society, 'manage_meetings');
  if char_length(coalesce(v_title, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Title must be at least 3 characters.';
  end if;
  if p_meeting_date is null or p_meeting_date < public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Choose a date from today onwards.';
  end if;
  perform public._resolve_meeting_scope(p_society, p_scope_type, p_unit_type_ids, p_unit_ids);

  insert into meetings (society_id, title, description, scope_type, scope_unit_type_ids, scope_unit_ids,
                         meeting_date, start_time, location, created_by, updated_by,
                         status, published_at)
  values (p_society, v_title, left(public.clean_body(p_description), 2000), p_scope_type,
          case when p_scope_type = 'unit_types' then p_unit_type_ids else '{}' end,
          case when p_scope_type = 'custom' then p_unit_ids else '{}' end,
          p_meeting_date, p_start_time, left(public.clean_text(p_location), 200), auth.uid(), auth.uid(),
          case when p_publish then 'published' else 'draft' end,
          case when p_publish then now() else null end)
  returning id into v_id;

  foreach v_item in array coalesce(p_agenda, '{}') loop
    v_item := public.clean_text(v_item);
    if char_length(coalesce(v_item, '')) > 0 then
      v_pos := v_pos + 1;
      insert into meeting_agenda_items (meeting_id, position, text) values (v_id, v_pos, left(v_item, 300));
    end if;
  end loop;

  if p_publish then
    perform public._notify(p_society, public._meeting_scope_user_ids(p_society, p_scope_type, p_unit_type_ids, p_unit_ids),
      'meeting_called', v_id, format('Meeting: %s', v_title),
      format('%s at %s — %s expected to attend', to_char(p_meeting_date, 'DD Mon YYYY'), to_char(p_start_time, 'HH12:MI AM'),
             public._meeting_audience_label(v_id)),
      '/meetings/' || v_id);
    -- let everyone else in the society know it's happening even if they're not required to attend
    if p_scope_type <> 'all' then
      perform public._notify(p_society,
        (select coalesce(array_agg(user_id), '{}') from memberships
          where society_id = p_society and status = 'active'
            and user_id <> all(public._meeting_scope_user_ids(p_society, p_scope_type, p_unit_type_ids, p_unit_ids))),
        'meeting_called_fyi', v_id, format('Meeting called: %s', v_title),
        format('%s at %s — for %s', to_char(p_meeting_date, 'DD Mon YYYY'), to_char(p_start_time, 'HH12:MI AM'), public._meeting_audience_label(v_id)),
        '/meetings/' || v_id);
    end if;
  end if;

  return v_id;
end $$;

create or replace function public.update_meeting(
  p_meeting_id uuid,
  p_title text,
  p_description text,
  p_meeting_date date,
  p_start_time time,
  p_location text,
  p_scope_type text,
  p_unit_type_ids uuid[],
  p_unit_ids uuid[]
) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt record;
  v_title text := public.clean_text(p_title);
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_perm(mt.society_id, 'manage_meetings');
  if mt.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'This meeting was cancelled.';
  end if;
  if char_length(coalesce(v_title, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Title must be at least 3 characters.';
  end if;
  if p_meeting_date is null or p_meeting_date < public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Choose a date from today onwards.';
  end if;
  perform public._resolve_meeting_scope(mt.society_id, p_scope_type, p_unit_type_ids, p_unit_ids);

  update meetings set
    title = v_title,
    description = left(public.clean_body(p_description), 2000),
    meeting_date = p_meeting_date,
    start_time = p_start_time,
    location = left(public.clean_text(p_location), 200),
    scope_type = p_scope_type,
    scope_unit_type_ids = case when p_scope_type = 'unit_types' then p_unit_type_ids else '{}' end,
    scope_unit_ids = case when p_scope_type = 'custom' then p_unit_ids else '{}' end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = mt.id;

  if mt.status = 'published' then
    perform public._notify(mt.society_id, public._meeting_scope_user_ids(mt.society_id, p_scope_type, p_unit_type_ids, p_unit_ids),
      'meeting_updated', mt.id, format('Meeting updated: %s', v_title),
      format('%s at %s — %s expected to attend', to_char(p_meeting_date, 'DD Mon YYYY'), to_char(p_start_time, 'HH12:MI AM'),
             public._meeting_audience_label(mt.id)),
      '/meetings/' || mt.id);
  end if;
end $$;

create or replace function public.set_meeting_agenda(p_meeting_id uuid, p_items text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  mt record;
  v_item text;
  v_pos int := 0;
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_perm(mt.society_id, 'manage_meetings');

  delete from meeting_agenda_items where meeting_id = mt.id;
  foreach v_item in array coalesce(p_items, '{}') loop
    v_item := public.clean_text(v_item);
    if char_length(coalesce(v_item, '')) > 0 then
      v_pos := v_pos + 1;
      insert into meeting_agenda_items (meeting_id, position, text) values (mt.id, v_pos, left(v_item, 300));
    end if;
  end loop;
  update meetings set updated_by = auth.uid(), updated_at = now() where id = mt.id;

  if mt.status = 'published' then
    perform public._notify(mt.society_id,
      public._meeting_scope_user_ids(mt.society_id, mt.scope_type, mt.scope_unit_type_ids, mt.scope_unit_ids),
      'meeting_agenda_updated', mt.id, format('Agenda updated: %s', mt.title), 'The agenda for this meeting changed.',
      '/meetings/' || mt.id);
  end if;
end $$;

create or replace function public.publish_meeting(p_meeting_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt record;
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_perm(mt.society_id, 'manage_meetings');
  if mt.status = 'published' then return; end if;
  if mt.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'This meeting was cancelled.';
  end if;
  update meetings set status = 'published', published_at = now() where id = mt.id;

  perform public._notify(mt.society_id,
    public._meeting_scope_user_ids(mt.society_id, mt.scope_type, mt.scope_unit_type_ids, mt.scope_unit_ids),
    'meeting_called', mt.id, format('Meeting: %s', mt.title),
    format('%s at %s — %s expected to attend', to_char(mt.meeting_date, 'DD Mon YYYY'), to_char(mt.start_time, 'HH12:MI AM'),
           public._meeting_audience_label(mt.id)),
    '/meetings/' || mt.id);
  if mt.scope_type <> 'all' then
    perform public._notify(mt.society_id,
      (select coalesce(array_agg(user_id), '{}') from memberships
        where society_id = mt.society_id and status = 'active'
          and user_id <> all(public._meeting_scope_user_ids(mt.society_id, mt.scope_type, mt.scope_unit_type_ids, mt.scope_unit_ids))),
      'meeting_called_fyi', mt.id, format('Meeting called: %s', mt.title),
      format('%s at %s — for %s', to_char(mt.meeting_date, 'DD Mon YYYY'), to_char(mt.start_time, 'HH12:MI AM'), public._meeting_audience_label(mt.id)),
      '/meetings/' || mt.id);
  end if;
end $$;

create or replace function public.cancel_meeting(p_meeting_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare mt record; v_reason text := public.clean_text(p_reason);
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_perm(mt.society_id, 'manage_meetings');
  update meetings set status = 'cancelled' where id = mt.id;
  if mt.status = 'published' then
    perform public._notify(mt.society_id,
      public._meeting_scope_user_ids(mt.society_id, mt.scope_type, mt.scope_unit_type_ids, mt.scope_unit_ids),
      'meeting_cancelled', mt.id, format('Meeting cancelled: %s', mt.title), coalesce(left(v_reason, 300), ''), '/meetings/' || mt.id);
  end if;
end $$;

create or replace function public.delete_meeting_draft(p_meeting_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mt record;
begin
  select * into mt from meetings where id = p_meeting_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_perm(mt.society_id, 'manage_meetings');
  if mt.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Only a draft meeting can be deleted — cancel a published one instead.';
  end if;
  delete from meetings where id = mt.id;
end $$;

revoke execute on function public.create_meeting(uuid, text, text, date, time, text, text, uuid[], uuid[], text[], boolean) from public, anon;
grant execute on function public.create_meeting(uuid, text, text, date, time, text, text, uuid[], uuid[], text[], boolean) to authenticated;
revoke execute on function public.update_meeting(uuid, text, text, date, time, text, text, uuid[], uuid[]) from public, anon;
grant execute on function public.update_meeting(uuid, text, text, date, time, text, text, uuid[], uuid[]) to authenticated;
revoke execute on function public.set_meeting_agenda(uuid, text[]) from public, anon;
grant execute on function public.set_meeting_agenda(uuid, text[]) to authenticated;
revoke execute on function public.publish_meeting(uuid) from public, anon;
grant execute on function public.publish_meeting(uuid) to authenticated;
revoke execute on function public.cancel_meeting(uuid, text) from public, anon;
grant execute on function public.cancel_meeting(uuid, text) to authenticated;
revoke execute on function public.delete_meeting_draft(uuid) from public, anon;
grant execute on function public.delete_meeting_draft(uuid) to authenticated;
