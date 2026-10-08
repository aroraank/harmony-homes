-- 1) Receipt lookup by number  2) Shared contacts directory (any member adds)  3) Member agenda suggestions with approval

-- ---------------------------------------------------------------------------
-- helper: "Name · P3-FF" (or role for staff) for people in the same society
-- ---------------------------------------------------------------------------
create or replace function public._person_label(p_user uuid, p_society uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_member(p_society) and p_user is not null then
    (select p.full_name || coalesce(
        ' · ' || (select u.code from memberships m join units u on u.id = m.unit_id
                   where m.user_id = p_user and m.society_id = p_society and m.status = 'active' and m.unit_id is not null limit 1),
        (select case m.role when 'super_admin' then ' · Super admin' when 'admin' then ' · Admin' else '' end
           from memberships m where m.user_id = p_user and m.society_id = p_society and m.status = 'active' limit 1),
        '')
       from profiles p where p.id = p_user)
  end
$$;
revoke execute on function public._person_label(uuid, uuid) from public, anon;
grant execute on function public._person_label(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Receipt lookup. Admins find any receipt; a member can only find receipts of their own flat.
--    Accepts "HH/2026-27/0010" (any case / spaces) or just the number "10".
-- ---------------------------------------------------------------------------
create or replace function public.find_receipt(p_society uuid, p_receipt text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v text := upper(regexp_replace(coalesce(p_receipt, ''), '\s+', '', 'g'));
  v_admin boolean;
begin
  perform public.assert_member(p_society);
  if char_length(v) < 1 or char_length(v) > 40 then
    raise exception using errcode = 'P0001', message = 'Type a receipt number, e.g. HH/2026-27/0010.';
  end if;
  v_admin := public.is_admin(p_society);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'entry_id', e.id, 'receipt_no', e.receipt_no, 'date', e.entry_date, 'amount_paise', e.amount_paise,
        'unit_code', u.code, 'unit_name', u.display_name, 'fund', f.name, 'mode', e.payment_mode,
        'reference_no', e.reference_no, 'note', e.note,
        'cancelled', public.is_entry_reversed(e.id) or e.reverses_entry_id is not null,
        'recorded_by', rp.full_name, 'recorded_at', e.created_at,
        'covers', coalesce((select jsonb_agg(public.due_label(a.due_id) order by a.created_at)
                              from due_allocations a where a.ledger_entry_id = e.id), '[]'::jsonb)
      ) order by e.entry_date desc, e.created_at desc)
    from ledger_entries e
    left join units u on u.id = e.unit_id
    left join funds f on f.id = e.fund_id
    left join profiles rp on rp.id = e.created_by
   where e.society_id = p_society and e.receipt_no is not null
     and (upper(e.receipt_no) = v or (v ~ '^[0-9]{1,6}$' and e.receipt_no ~ ('/0*' || ltrim(v, '0') || '$')))
     and (v_admin or e.unit_id in (select public.my_unit_ids(p_society)))
  ), '[]'::jsonb);
end $$;
revoke execute on function public.find_receipt(uuid, text) from public, anon;
grant execute on function public.find_receipt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Contacts directory
-- ---------------------------------------------------------------------------
create or replace function public._phones_ok(p text[]) returns boolean
language sql immutable as $$ select coalesce(bool_and(x ~ '^[6-9][0-9]{9}$'), true) from unnest(p) x $$;

alter table public.contacts add column if not exists extra_phones text[] not null default '{}';
do $$ begin
  alter table public.contacts add constraint contacts_extra_phones_ok
    check (coalesce(array_length(extra_phones, 1), 0) <= 3 and public._phones_ok(extra_phones));
exception when duplicate_object then null; end $$;

-- normalise a list of phone inputs: valid 10-digit numbers, no duplicates, 1..5 of them
create or replace function public._clean_phones(p_phones text[]) returns text[]
language plpgsql immutable set search_path = public as $$
declare v_out text[] := '{}'; x text; n text;
begin
  foreach x in array coalesce(p_phones, '{}') loop
    if x is null or btrim(x) = '' then continue; end if;
    n := public.norm_phone(x);
    if n is null or n !~ '^[6-9][0-9]{9}$' then
      raise exception using errcode = 'P0001', message = format('"%s" is not a valid 10-digit mobile number.', x);
    end if;
    if not (n = any(v_out)) then v_out := v_out || n; end if;
  end loop;
  if coalesce(array_length(v_out, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'Add at least one phone number.';
  end if;
  if array_length(v_out, 1) > 5 then
    raise exception using errcode = 'P0001', message = 'At most 5 phone numbers per contact.';
  end if;
  return v_out;
end $$;

create or replace function public.add_contact(
  p_society uuid, p_category_id uuid, p_name text, p_phones text[], p_notes text,
  p_timings text, p_typical_rate text, p_whatsapp boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := public.clean_text(p_name); v_ph text[]; v_dup text;
begin
  perform public.assert_member(p_society);
  if not exists (select 1 from contact_categories where id = p_category_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a job tag from the list.';
  end if;
  if char_length(coalesce(v_name, '')) not between 2 and 60 then
    raise exception using errcode = 'P0001', message = 'Name must be 2–60 characters.';
  end if;
  v_ph := public._clean_phones(p_phones);
  select c.name into v_dup from contacts c
   where c.society_id = p_society and c.status in ('active', 'suggested')
     and (c.phone = any(v_ph) or c.alt_phone = any(v_ph) or c.extra_phones && v_ph) limit 1;
  if v_dup is not null then
    raise exception using errcode = 'P0001', message = format('This number is already in the directory (%s).', v_dup);
  end if;
  if (select count(*) from contacts where added_by = auth.uid() and created_at > now() - interval '1 day') >= 15 then
    raise exception using errcode = 'P0001', message = 'You have added many contacts today. Please try again tomorrow.';
  end if;
  insert into contacts (society_id, category_id, name, phone, alt_phone, extra_phones, whatsapp, notes, timings, typical_rate,
                        status, added_by, approved_by)
  values (p_society, p_category_id, v_name, v_ph[1], v_ph[2], coalesce(v_ph[3:5], '{}'), coalesce(p_whatsapp, true),
          left(public.clean_text(p_notes), 300), left(public.clean_text(p_timings), 80), left(public.clean_text(p_typical_rate), 80),
          'active', auth.uid(), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_contact(
  p_contact_id uuid, p_category_id uuid, p_name text, p_phones text[], p_notes text,
  p_timings text, p_typical_rate text, p_whatsapp boolean default true
) returns void
language plpgsql security definer set search_path = public as $$
declare c record; v_name text := public.clean_text(p_name); v_ph text[]; v_dup text;
begin
  select * into c from contacts where id = p_contact_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Contact not found.'; end if;
  perform public.assert_member(c.society_id);
  if not (c.added_by = auth.uid() or public.user_has_perm(auth.uid(), c.society_id, 'manage_contacts')) then
    raise exception using errcode = '42501', message = 'Only the person who added this contact, or an admin, can change it.';
  end if;
  if c.status not in ('active', 'suggested') then raise exception using errcode = 'P0001', message = 'This contact was removed.'; end if;
  if not exists (select 1 from contact_categories where id = p_category_id and society_id = c.society_id) then
    raise exception using errcode = 'P0001', message = 'Choose a job tag from the list.';
  end if;
  if char_length(coalesce(v_name, '')) not between 2 and 60 then
    raise exception using errcode = 'P0001', message = 'Name must be 2–60 characters.';
  end if;
  v_ph := public._clean_phones(p_phones);
  select x.name into v_dup from contacts x
   where x.society_id = c.society_id and x.id <> c.id and x.status in ('active', 'suggested')
     and (x.phone = any(v_ph) or x.alt_phone = any(v_ph) or x.extra_phones && v_ph) limit 1;
  if v_dup is not null then
    raise exception using errcode = 'P0001', message = format('This number is already in the directory (%s).', v_dup);
  end if;
  update contacts set category_id = p_category_id, name = v_name, phone = v_ph[1], alt_phone = v_ph[2],
         extra_phones = coalesce(v_ph[3:5], '{}'), whatsapp = coalesce(p_whatsapp, true),
         notes = left(public.clean_text(p_notes), 300), timings = left(public.clean_text(p_timings), 80),
         typical_rate = left(public.clean_text(p_typical_rate), 80), updated_at = now()
   where id = c.id;
end $$;

create or replace function public.archive_contact(p_contact_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select * into c from contacts where id = p_contact_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Contact not found.'; end if;
  perform public.assert_member(c.society_id);
  if not (c.added_by = auth.uid() or public.user_has_perm(auth.uid(), c.society_id, 'manage_contacts')) then
    raise exception using errcode = '42501', message = 'Only the person who added this contact, or an admin, can remove it.';
  end if;
  update contacts set status = 'archived', updated_at = now() where id = c.id;
end $$;

create or replace function public.contact_directory(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mgr boolean;
begin
  perform public.assert_member(p_society);
  v_mgr := public.user_has_perm(auth.uid(), p_society, 'manage_contacts');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'category_id', c.category_id, 'category', cc.name, 'name', c.name,
        'phones', to_jsonb(array_remove(array[c.phone, c.alt_phone] || c.extra_phones, null)),
        'whatsapp', c.whatsapp, 'notes', c.notes, 'timings', c.timings, 'typical_rate', c.typical_rate,
        'status', c.status, 'added_by', c.added_by, 'added_by_label', public._person_label(c.added_by, p_society),
        'added_at', c.created_at, 'can_edit', (c.added_by = auth.uid() or v_mgr))
      order by lower(c.name), c.created_at)
    from contacts c join contact_categories cc on cc.id = c.category_id
   where c.society_id = p_society
     and (c.status = 'active' or (c.status = 'suggested' and (v_mgr or c.added_by = auth.uid())))
  ), '[]'::jsonb);
end $$;

revoke execute on function public.add_contact(uuid, uuid, text, text[], text, text, text, boolean) from public, anon;
revoke execute on function public.update_contact(uuid, uuid, text, text[], text, text, text, boolean) from public, anon;
revoke execute on function public.contact_directory(uuid) from public, anon;
revoke execute on function public._clean_phones(text[]) from public, anon, authenticated;
grant execute on function public.add_contact(uuid, uuid, text, text[], text, text, text, boolean) to authenticated;
grant execute on function public.update_contact(uuid, uuid, text, text[], text, text, text, boolean) to authenticated;
grant execute on function public.contact_directory(uuid) to authenticated;
grant execute on function public.archive_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Meeting agenda: admin items + member suggestions that wait for approval
-- ---------------------------------------------------------------------------
alter table public.meeting_agenda_items
  add column if not exists status text not null default 'approved' check (status in ('approved', 'suggested', 'rejected')),
  add column if not exists suggested_by uuid references public.profiles(id),
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists created_at timestamptz not null default now();

create or replace view public.v_meetings with (security_invoker = true) as
select
  mt.id, mt.society_id, mt.title, mt.description, mt.status, mt.scope_type,
  mt.scope_unit_type_ids, mt.scope_unit_ids, mt.meeting_date, mt.start_time, mt.location,
  mt.created_by, mt.published_at, mt.created_at, mt.updated_at,
  public._meeting_audience_label(mt.id) as audience_label,
  coalesce((select jsonb_agg(jsonb_build_object(
                'id', ai.id, 'text', ai.text, 'status', ai.status,
                'by', case when ai.suggested_by is not null then public._person_label(ai.suggested_by, mt.society_id) end,
                'mine', ai.suggested_by is not null and ai.suggested_by = auth.uid())
              order by (ai.status = 'suggested'), ai.position, ai.created_at)
              from meeting_agenda_items ai where ai.meeting_id = mt.id and ai.status <> 'rejected'), '[]'::jsonb) as agenda,
  p.full_name as created_by_name
from meetings mt
left join profiles p on p.id = mt.created_by;
revoke all on public.v_meetings from anon, authenticated;
grant select on public.v_meetings to authenticated;

-- The admin's agenda editor only replaces the admin-written items; member suggestions are kept.
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

  delete from meeting_agenda_items where meeting_id = mt.id and suggested_by is null;
  foreach v_item in array coalesce(p_items, '{}') loop
    v_item := public.clean_text(v_item);
    if char_length(coalesce(v_item, '')) > 0 then
      v_pos := v_pos + 1;
      insert into meeting_agenda_items (meeting_id, position, text) values (mt.id, v_pos, left(v_item, 300));
    end if;
  end loop;
  -- member items follow the admin items
  with r as (select id, row_number() over (order by position, created_at) as rn from meeting_agenda_items
              where meeting_id = mt.id and suggested_by is not null)
  update meeting_agenda_items ai set position = v_pos + r.rn from r where ai.id = r.id;
  update meetings set updated_by = auth.uid(), updated_at = now() where id = mt.id;

  if mt.status = 'published' then
    perform public._notify(mt.society_id,
      public._meeting_scope_user_ids(mt.society_id, mt.scope_type, mt.scope_unit_type_ids, mt.scope_unit_ids),
      'meeting_agenda_updated', mt.id, format('Agenda updated: %s', mt.title), 'The agenda for this meeting changed.',
      '/meetings/' || mt.id);
  end if;
end $$;

create or replace function public.suggest_agenda_item(p_meeting_id uuid, p_text text) returns uuid
language plpgsql security definer set search_path = public as $$
declare mt record; v_text text := public.clean_text(p_text); v_id uuid; v_pos int;
begin
  select * into mt from meetings where id = p_meeting_id;
  if not found then raise exception using errcode = 'P0001', message = 'Meeting not found.'; end if;
  perform public.assert_member(mt.society_id);
  if mt.status <> 'published' or mt.meeting_date < public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Agenda points can only be suggested for an upcoming published meeting.';
  end if;
  if char_length(coalesce(v_text, '')) not between 3 and 300 then
    raise exception using errcode = 'P0001', message = 'Write the agenda point in 3–300 characters.';
  end if;
  if exists (select 1 from meeting_agenda_items where meeting_id = mt.id and status <> 'rejected' and lower(text) = lower(v_text)) then
    raise exception using errcode = 'P0001', message = 'This agenda point is already on the list.';
  end if;
  if (select count(*) from meeting_agenda_items where meeting_id = mt.id and suggested_by = auth.uid() and status = 'suggested') >= 3 then
    raise exception using errcode = 'P0001', message = 'You already have 3 suggestions waiting for approval for this meeting.';
  end if;
  select coalesce(max(position), 0) + 1 into v_pos from meeting_agenda_items where meeting_id = mt.id;
  insert into meeting_agenda_items (meeting_id, position, text, status, suggested_by)
  values (mt.id, v_pos, v_text, 'suggested', auth.uid()) returning id into v_id;
  perform public._notify(mt.society_id, public._perm_user_ids(mt.society_id, 'manage_meetings'), 'agenda_suggested', mt.id,
    format('Agenda suggestion: %s', mt.title), left(public._person_label(auth.uid(), mt.society_id) || ': ' || v_text, 380),
    '/meetings/' || mt.id);
  return v_id;
end $$;

create or replace function public.review_agenda_item(p_item_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ai record; mt record;
begin
  select * into ai from meeting_agenda_items where id = p_item_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Agenda point not found.'; end if;
  select * into mt from meetings where id = ai.meeting_id;
  perform public.assert_perm(mt.society_id, 'manage_meetings');
  if ai.status <> 'suggested' then raise exception using errcode = 'P0001', message = 'Already reviewed.'; end if;
  update meeting_agenda_items set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = auth.uid()
   where id = ai.id;
  if ai.suggested_by is not null then
    perform public._notify(mt.society_id, array[ai.suggested_by], 'agenda_reviewed', mt.id,
      case when p_approve then 'Your agenda point was accepted' else 'Your agenda point was not taken up' end,
      left(ai.text, 300), '/meetings/' || mt.id);
  end if;
end $$;

-- the suggester can take back a suggestion that is still waiting; admins can remove any suggestion
create or replace function public.delete_agenda_suggestion(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ai record; mt record;
begin
  select * into ai from meeting_agenda_items where id = p_item_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Agenda point not found.'; end if;
  select * into mt from meetings where id = ai.meeting_id;
  perform public.assert_member(mt.society_id);
  if ai.suggested_by is null then raise exception using errcode = 'P0001', message = 'Only member suggestions can be removed this way.'; end if;
  if not ((ai.suggested_by = auth.uid() and ai.status = 'suggested') or public.user_has_perm(auth.uid(), mt.society_id, 'manage_meetings')) then
    raise exception using errcode = '42501', message = 'You cannot remove this agenda point.';
  end if;
  delete from meeting_agenda_items where id = ai.id;
end $$;

revoke execute on function public.suggest_agenda_item(uuid, text) from public, anon;
revoke execute on function public.review_agenda_item(uuid, boolean) from public, anon;
revoke execute on function public.delete_agenda_suggestion(uuid) from public, anon;
grant execute on function public.suggest_agenda_item(uuid, text) to authenticated;
grant execute on function public.review_agenda_item(uuid, boolean) to authenticated;
grant execute on function public.delete_agenda_suggestion(uuid) to authenticated;
grant execute on function public.set_meeting_agenda(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Event report: every payment line also carries its receipt number and mode (for PDF / Excel tracking)
-- ---------------------------------------------------------------------------
create or replace function public.event_report(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_society uuid;
begin
  select society_id into v_society from events where id = p_event_id;
  if v_society is null then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_member(v_society);
  v := public._event_report(p_event_id);
  v := jsonb_set(v, '{entries}', coalesce((
    select jsonb_agg(x || jsonb_build_object('receipt_no', e.receipt_no, 'mode', e.payment_mode) order by t.ord)
      from jsonb_array_elements(v -> 'entries') with ordinality as t(x, ord)
      left join ledger_entries e on e.id = (x ->> 'entry_id')::uuid), '[]'::jsonb));
  if public.is_admin(v_society) then return v; end if;
  return jsonb_set(v, '{units}', coalesce((
    select jsonb_agg(x) from jsonb_array_elements(v -> 'units') x
     where (x ->> 'status') not in ('pending', 'partial')
        or (x ->> 'unit_id')::uuid in (select public.my_unit_ids(v_society))), '[]'::jsonb));
end $$;
grant execute on function public.event_report(uuid) to authenticated;
