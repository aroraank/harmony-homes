-- Regression fix: a later migration re-created run_daily_jobs() from an older copy and
-- accidentally dropped the `monthly_dues_enabled` guard added in
-- 20261008000009_monthly_dues_switch_progress.sql. As a result, the legacy monthly
-- "maintenance" dues generator kept running every night even for societies that switched
-- it off in favour of event-based billing (e.g. Harmony Homes, which bills via the
-- "Security guard salary" recurring event) — creating a duplicate, unwanted due each month.
-- This restores the guard on top of the current (newer) function body, with nothing else
-- changed: _activate_due_series_events and the always-visible expense drafts stay as-is.

create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int; v_activated int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days, st.monthly_dues_enabled from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0; v_activated := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if s.monthly_dues_enabled and v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
        v_dues := public._generate_monthly_dues(s.id, v_period, true);
      end if;
      v_series := public._generate_series_events(s.id);
      v_activated := public._activate_due_series_events(s.id);
      v_drafts := public._generate_expense_drafts(s.id, v_period, false);
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
