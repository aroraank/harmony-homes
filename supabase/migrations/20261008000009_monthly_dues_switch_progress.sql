-- Harmony Homes — a switch for the classic monthly maintenance dues (off when a recurring event replaces them),
-- and the progress of the month that is being collected right now.

alter table public.society_settings add column if not exists monthly_dues_enabled boolean not null default true;

-- daily job: skip monthly maintenance dues when switched off
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days, st.monthly_dues_enabled from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if s.monthly_dues_enabled and v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_series := public._generate_series_events(s.id);
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
                                         'recurring_events', v_series, 'locations_purged', v_purged);
  end loop;
  return v_out;
end $$;

-- Progress of the recurring events of one month: how many flats paid, part-paid, pending
create or replace function public.series_month_progress(p_society uuid, p_period text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_member(p_society);
  if not public.is_valid_period(p_period) then raise exception using errcode = 'P0001', message = 'Invalid month.'; end if;
  select jsonb_build_object(
           'period', p_period,
           'event_id', (array_agg(e.id order by e.created_at))[1],
           'events', count(distinct e.id),
           'title', (array_agg(e.title order by e.created_at))[1],
           'due_date', min(e.due_date),
           'expected_paise', coalesce(sum(x.expected), 0),
           'collected_paise', coalesce(sum(x.collected), 0),
           'paid', coalesce(sum(x.paid), 0), 'partial', coalesce(sum(x.partial), 0),
           'pending', coalesce(sum(x.pending), 0), 'waived', coalesce(sum(x.waived), 0))
    into v
    from events e
    cross join lateral (
      select coalesce(sum(d.amount_paise) filter (where not d.waived), 0) as expected,
             coalesce(sum(least(public.due_paid_paise(d.id), d.amount_paise)) filter (where not d.waived), 0) as collected,
             count(*) filter (where not d.waived and public.due_paid_paise(d.id) >= d.amount_paise) as paid,
             count(*) filter (where not d.waived and public.due_paid_paise(d.id) > 0 and public.due_paid_paise(d.id) < d.amount_paise) as partial,
             count(*) filter (where not d.waived and public.due_paid_paise(d.id) = 0) as pending,
             count(*) filter (where d.waived) as waived
        from dues d where d.event_id = e.id) x
   where e.society_id = p_society and e.series_period = p_period and e.status <> 'draft';
  if v is null or (v ->> 'events')::int = 0 then return null; end if;
  return v;
end $$;
grant execute on function public.series_month_progress(uuid, text) to authenticated;
