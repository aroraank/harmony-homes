-- Recurring events that are due the FOLLOWING month (due_month_offset = 1, e.g. "Security guard
-- salary") should stay completely invisible to members — no entry in Dues, no notification — until
-- the due month actually begins. Before this, the event was published and shown as "Pending" with a
-- future due date as soon as it was created, which members found confusing. Events due the SAME
-- month (due_month_offset = 0) are unaffected: those still open immediately, as before.

-- 1) Don't open next-month-due events immediately; leave them as 'draft' (invisible to members —
--    the existing events_overview / event pages already hide drafts from non-admins).
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
  -- Due the same month: open (and notify) right away, as before.
  -- Due next month: stay a hidden draft until the due month begins (see _activate_due_series_events).
  if s.due_month_offset = 0 then
    perform public._open_event(v_id);
  end if;
  return v_id;
end $$;
revoke execute on function public._publish_series_month(uuid, text) from public, anon, authenticated;

-- 2) Daily job helper: open any series-generated draft event whose due month has now started.
create or replace function public._activate_due_series_events(p_society uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int := 0; r record;
begin
  for r in
    select e.id from events e
     where e.society_id = p_society and e.status = 'draft' and e.series_id is not null
       and public.period_of(e.due_date) <= public.period_of(public.ist_today())
     order by e.due_date
  loop
    perform public._open_event(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke execute on function public._activate_due_series_events(uuid) from public, anon, authenticated;

-- 3) Wire it into the daily job.
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int; v_activated int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0; v_activated := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_series := public._generate_series_events(s.id);
      v_activated := public._activate_due_series_events(s.id);
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
    v_out := v_out || jsonb_build_object('society_id', s.id, 'dues', v_dues, 'drafts', v_drafts, 'reminders', v_rem,
                                         'recurring_events', v_series, 'activated_events', v_activated, 'locations_purged', v_purged);
  end loop;
  return v_out;
end $$;

-- 4) One-time correction: "Security guard salary – October 2026" (and any other next-month-due
--    series event) was already opened and shown to members under the old behaviour, ahead of its
--    due month. Put it back to a hidden draft — but ONLY if nothing real has been paid against it
--    yet, so no money or receipt is ever touched.
do $$
declare r record; v_has_entries boolean; v_count int := 0;
begin
  for r in
    select e.id, e.fund_id from events e
     where e.series_id is not null and e.status = 'open'
       and public.period_of(e.due_date) > public.period_of(public.ist_today())
  loop
    select exists(select 1 from ledger_entries where fund_id = r.fund_id) into v_has_entries;
    if v_has_entries then
      raise notice 'Left event % open — real payments are already recorded against it.', r.id;
      continue;
    end if;
    delete from due_allocations where due_id in (select id from dues where event_id = r.id);
    delete from dues where event_id = r.id;
    delete from notifications where kind = 'event_due' and ref_id = r.id;
    update events set fund_id = null, status = 'draft', opened_at = null where id = r.id;
    delete from funds where id = r.fund_id;
    v_count := v_count + 1;
  end loop;
  raise notice '% event(s) reverted to a hidden draft until their due month begins.', v_count;
end $$;
