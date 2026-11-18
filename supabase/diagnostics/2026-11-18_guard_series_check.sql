-- Harmony Homes — READ-ONLY check to run in the Supabase SQL editor BEFORE the 20261118000001 migration.
-- It changes nothing. It shows the guard recurring event as it is now, so we know the migration will
-- find it and what ₹1,000 per flat adds up to.

-- 1) The recurring event(s) whose name starts with "Security guard salary"
select es.id, es.title, es.total_cost_paise / 100 as total_rupees, es.pending_total_paise / 100 as pending_rupees,
       es.pending_from_period, es.due_day, es.due_month_offset, es.is_active, es.scope_type,
       (select count(*) from units u where u.society_id = es.society_id and u.is_billable
           and (es.scope_type = 'all' or u.unit_type_id = any(es.scope_unit_type_ids))) as flats_in_scope
  from event_series es
 where es.title ilike 'security guard salary%';

-- 2) Months already generated and the per-flat amount stored on each (these must stay as they are)
select e.series_period, e.status, e.total_cost_paise / 100 as total_rupees, e.per_unit_share_paise / 100 as per_flat_rupees,
       e.in_scope_count, e.due_date
  from events e join event_series es on es.id = e.series_id
 where es.title ilike 'security guard salary%'
 order by e.series_period;

-- 3) Today's month as the database sees it (the change starts with the 2026-12 event)
select public.period_of(public.ist_today()) as current_period;
