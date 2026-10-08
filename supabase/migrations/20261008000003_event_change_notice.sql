-- Harmony Homes — when an open event's amount changes, every flat in scope gets a
-- notice they must read (scroll to the end) and accept before using the app.
-- Reuses the existing notices + receipts + blocking acknowledgement popup + push.

create or replace function public._system_notice(
  p_society uuid, p_title text, p_body text, p_priority text, p_unit_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_users uuid[];
begin
  select array_agg(a.user_id) into v_users
    from public._audience(p_society, 'units', '{}', coalesce(p_unit_ids, '{}')) a;
  if coalesce(array_length(v_users, 1), 0) = 0 then
    return null;  -- nobody has a login on those flats yet
  end if;
  insert into notices (society_id, title, body, priority, audience_type, audience_unit_ids, require_ack, created_by)
  values (p_society, p_title, left(p_body, 5000), p_priority, 'units', p_unit_ids, true, auth.uid())
  returning id into v_id;
  insert into notice_receipts (notice_id, society_id, user_id, unit_id)
  select v_id, p_society, a.user_id, a.unit_id
    from public._audience(p_society, 'units', '{}', coalesce(p_unit_ids, '{}')) a;
  perform public._notify(p_society, v_users, 'notice', v_id,
    case when p_priority = 'important' then 'Important: ' else '' end || p_title,
    left(regexp_replace(p_body, '\s+', ' ', 'g'), 160), '/notices/' || v_id);
  return v_id;
end $$;
revoke execute on function public._system_notice(uuid, text, text, text, uuid[]) from public, anon, authenticated;

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
  v_old_share bigint;
  v_old_total bigint;
  v_actor text;
  v_body text;
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

  v_old_share := ev.per_unit_share_paise;
  v_old_total := ev.total_cost_paise;
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

    select full_name into v_actor from profiles where id = auth.uid();
    v_body := format(
      E'The amount for "%s" was changed by %s.\n\n'
      || E'Total target: %s → %s\n'
      || E'Share per flat: %s → %s (%s flats paying)\n'
      || E'Due by: %s\n\n'
      || E'Reason: %s',
      ev.title, coalesce(v_actor, 'an admin'),
      public.fmt_inr(v_old_total), public.fmt_inr(p_total_cost_paise),
      public.fmt_inr(v_old_share), public.fmt_inr(v_share), v_expected,
      to_char(ev.due_date, 'DD Mon YYYY'), v_reason);
    if coalesce(array_length(v_excluded, 1), 0) > 0 then
      v_body := v_body || E'\n\nNot paying for this event: ' ||
        (select string_agg(u.code || ' (' || coalesce(v_reasons ->> u.id::text, 'excluded') || ')', ', ' order by u.sort_order, u.code)
           from units u where u.id = any(v_excluded));
    end if;
    -- every flat in scope (including newly excluded ones) must read and accept the change
    perform public._system_notice(ev.society_id, left('Amount changed: ' || ev.title, 120), v_body, 'important', v_scope);
  end if;

  return jsonb_build_object('per_unit_share_paise', v_share, 'expected_count', v_expected, 'total_cost_paise', p_total_cost_paise);
end $$;

revoke execute on function public.update_event_target(uuid, bigint, jsonb, text) from public, anon;
grant execute on function public.update_event_target(uuid, bigint, jsonb, text) to authenticated;
