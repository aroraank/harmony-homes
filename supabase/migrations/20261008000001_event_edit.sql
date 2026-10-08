-- Harmony Homes — allow editing an event's target amount / exclusions.
-- Draft events: fully editable (nothing has been billed to anyone yet).
-- Open (published) events: the amount/exclusions can still be changed, but only while no
-- flat has paid anything against it yet (changing the per-flat share after money has moved
-- would corrupt the due/payment math) — once a payment lands, the admin must close/correct
-- the event the normal way instead. Every open-event edit is logged (via the existing audit
-- trigger on `events`) and notifies every flat currently expected to pay.

create or replace function public.update_event_target(
  p_event_id uuid,
  p_total_cost_paise bigint,
  p_excluded jsonb default '[]',
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev record;
  v_reason text := public.clean_text(p_reason);
  v_excl record;
  v_excluded uuid[] := '{}';
  v_reasons jsonb := '{}';
  v_scope uuid[];
  v_expected int;
  v_share bigint;
  v_paid_count int;
begin
  select * into ev from events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Event not found.';
  end if;
  perform public.assert_perm(ev.society_id, 'manage_events');
  if ev.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'This event is already closed.';
  end if;
  perform public._check_amount(p_total_cost_paise);

  select array_agg(unit_id) into v_scope from event_units where event_id = ev.id;

  for v_excl in select (x ->> 'unit_id')::uuid as unit_id, public.clean_text(x ->> 'reason') as reason
                  from jsonb_array_elements(coalesce(p_excluded, '[]'::jsonb)) x loop
    if not (v_excl.unit_id = any(v_scope)) then
      raise exception using errcode = 'P0001', message = 'An excluded flat is not in scope.';
    end if;
    if char_length(coalesce(v_excl.reason, '')) < 2 then
      raise exception using errcode = 'P0001', message = 'Give a reason for every excluded flat.';
    end if;
    if not (v_excl.unit_id = any(v_excluded)) then
      v_excluded := v_excluded || v_excl.unit_id;
      v_reasons := v_reasons || jsonb_build_object(v_excl.unit_id::text, left(v_excl.reason, 200));
    end if;
  end loop;

  v_expected := array_length(v_scope, 1) - coalesce(array_length(v_excluded, 1), 0);
  if v_expected < 1 then
    raise exception using errcode = 'P0001', message = 'At least one flat must be expected to pay.';
  end if;

  if ev.status = 'open' then
    select count(*) into v_paid_count
      from dues d
     where d.event_id = ev.id
       and exists (select 1 from due_allocations da where da.due_id = d.id);
    if v_paid_count > 0 then
      raise exception using errcode = 'P0001',
        message = 'Cannot change the amount — some flats have already paid against this event. Close it and raise a new one for the difference instead.';
    end if;
    if char_length(coalesce(v_reason, '')) < 3 then
      raise exception using errcode = 'P0001', message = 'Give a short reason — every flat will see it.';
    end if;
  end if;

  v_share := public.event_share_paise(p_total_cost_paise, v_expected, ev.rounding_paise);

  update events
     set total_cost_paise = p_total_cost_paise,
         expected_count = v_expected,
         per_unit_share_paise = v_share
   where id = ev.id;

  update event_units
     set expected = not (unit_id = any(v_excluded)),
         exclusion_reason = case when unit_id = any(v_excluded) then coalesce(v_reasons ->> unit_id::text, exclusion_reason) else null end
   where event_id = ev.id;

  if ev.status = 'open' then
    update dues set amount_paise = v_share
     where event_id = ev.id and unit_id in (select unit_id from event_units where event_id = ev.id and expected);
    delete from dues
     where event_id = ev.id and unit_id in (select unit_id from event_units where event_id = ev.id and not expected);
    insert into dues (society_id, unit_id, fund_id, due_type, event_id, amount_paise, due_date)
    select ev.society_id, eu.unit_id, ev.fund_id, 'event', ev.id, v_share, ev.due_date
      from event_units eu
     where eu.event_id = ev.id and eu.expected
       and not exists (select 1 from dues d where d.event_id = ev.id and d.unit_id = eu.unit_id);

    perform public._notify(ev.society_id, public._unit_user_ids(eu.unit_id), 'event_amount_changed', ev.id,
      format('%s: amount updated to %s per flat', ev.title, public.fmt_inr(v_share)),
      left(v_reason, 300), '/events/' || ev.id)
      from event_units eu where eu.event_id = ev.id and eu.expected;
  end if;

  return jsonb_build_object('per_unit_share_paise', v_share, 'expected_count', v_expected, 'total_cost_paise', p_total_cost_paise);
end $$;

create or replace function public.edit_event_draft(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_due_date date
) returns void
language plpgsql security definer set search_path = public as $$
declare
  ev record;
  v_title text := public.clean_text(p_title);
begin
  select * into ev from events where id = p_event_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Event not found.';
  end if;
  perform public.assert_perm(ev.society_id, 'manage_events');
  if ev.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Only a draft event''s title/description/date can be edited this way.';
  end if;
  if char_length(coalesce(v_title, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Title must be at least 3 characters.';
  end if;
  if p_due_date is null or p_due_date < public.ist_today() then
    raise exception using errcode = 'P0001', message = 'Choose a due date from today onwards.';
  end if;
  update events
     set title = v_title, description = left(public.clean_body(p_description), 2000), due_date = p_due_date
   where id = ev.id;
end $$;

revoke execute on function public.update_event_target(uuid, bigint, jsonb, text) from public, anon;
grant execute on function public.update_event_target(uuid, bigint, jsonb, text) to authenticated;
revoke execute on function public.edit_event_draft(uuid, text, text, date) from public, anon;
grant execute on function public.edit_event_draft(uuid, text, text, date) to authenticated;
