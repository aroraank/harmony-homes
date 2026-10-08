-- Harmony Homes — one-time load of the Security guard collection history (Feb 2026 → Sep 2026).
-- Run in the Supabase SQL editor after the database migrations (up to 0009) are applied.
-- If an earlier run of this script exists and nothing real has been recorded on top of it, that load is
-- removed first (and logged), then everything is loaded again — so it is safe to run again after a correction.
--
-- What it records (from the society tally of 8 Oct 2026):
--   * the recurring event "Security guard salary" (₹24,000 a month = 30 flats × ₹800, due on the 7th of the NEXT month)
--   * Feb–Aug 2026: ONLY the arrears that are still pending (one event per month, other flats marked
--     "Paid before tracking began"). Money collected earlier is deliberately not tracked.
--   * Sep 2026: all 30 flats are billed and the 21 payments received are recorded as real ledger entries
--   * P10-SF also paid Aug 2026 (received together with Sep) — recorded as a payment against the Aug event
--   * the daily job keeps publishing Oct 2026 onwards by itself
-- Monthly maintenance dues are switched off (the recurring event replaces them) and any unpaid ones are removed,
-- so nobody is billed twice. Nobody is notified by this script.

do $$
declare
  c_slug      constant text   := 'plot-colony';        -- society slug
  c_title     constant text   := 'Security guard salary';
  c_share     constant bigint := 80000;                -- ₹800 per flat, in paise
  c_start     constant text   := '2026-02';
  c_last      constant text   := '2026-09';
  c_mode      constant text   := 'cash';               -- how the Sep payments were received
  c_pay_date  constant date   := public.ist_today();   -- date shown on the payments (change if you know the real dates)

  -- Flats with NOTHING paid since February (8 months: Feb–Sep)
  v_never   constant text[] := array['P1-GF', 'P2-GF', 'P5-GF', 'P11-SF', 'P12-SF'];
  -- Flats that still owe specific months (everything else is paid up to Sep 2026)
  v_partial constant jsonb := '{
    "P2-FF": ["2026-08", "2026-09"],
    "P4-FF": ["2026-08", "2026-09"],
    "P3-FF": ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
    "P5-SF": ["2026-07", "2026-09"]
  }';
  -- Paid late (in Oct 2026) for an older month: flat → month
  v_late    constant jsonb := '{"P10-SF": "2026-08"}';

  v_society uuid; v_series uuid; v_rounding bigint; v_start timestamptz := now();
  v_period text; v_unit record; v_owes boolean; v_exp int; v_event uuid; v_fund uuid; v_total bigint; v_due date; v_n int := 0;
  v_missing text; v_old uuid; v_events uuid[]; v_funds uuid[];
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_series' and column_name = 'due_month_offset')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'society_settings' and column_name = 'monthly_dues_enabled') then
    raise exception 'The latest database update is missing. In your project folder run:  npx supabase db push   (migrations 0007, 0008 and 0009), then run this script again.';
  end if;
  select id into v_society from societies where slug = c_slug;
  if v_society is null then raise exception 'Society % not found', c_slug; end if;
  select id into v_old from event_series where society_id = v_society and title = c_title;
  if v_old is not null then
    select array_agg(id), array_agg(fund_id) into v_events, v_funds from events where series_id = v_old;
    if exists (select 1 from ledger_entries where fund_id = any(v_funds)
                and (created_by is not null or coalesce(note, '') not like 'Recorded from the society tally%')) then
      raise exception 'Real entries have been recorded on top of the earlier load, so it cannot be replaced automatically. Nothing was changed.';
    end if;
    perform audit_append(v_society, 'history_reload', 'event_series', v_old::text,
      jsonb_build_object('events', coalesce(array_length(v_events, 1), 0), 'ledger_entries', (select count(*) from ledger_entries where fund_id = any(v_funds))),
      jsonb_build_object('reason', 'Earlier load replaced with corrected amounts'));
    alter table public.due_allocations disable trigger user;
    alter table public.ledger_entries disable trigger user;
    delete from due_allocations where due_id in (select id from dues where event_id = any(v_events));
    delete from ledger_entries where fund_id = any(v_funds);
    alter table public.due_allocations enable trigger user;
    alter table public.ledger_entries enable trigger user;
    delete from dues where event_id = any(v_events);
    update events set fund_id = null where id = any(v_events);
    delete from event_units where event_id = any(v_events);
    delete from funds where event_id = any(v_events);
    delete from events where id = any(v_events);
    delete from event_series where id = v_old;
    if not exists (select 1 from ledger_entries where society_id = v_society) then
      delete from receipt_counters where society_id = v_society;   -- numbering starts again from 1
    end if;
    raise notice 'Earlier load removed.';
  end if;
  select string_agg(code, ', ') into v_missing from unnest(v_never || array(select jsonb_object_keys(v_partial)) || array(select jsonb_object_keys(v_late))) code
   where not exists (select 1 from units where society_id = v_society and units.code = code);
  if v_missing is not null then raise exception 'Flat code(s) not found: %', v_missing; end if;
  if (select count(*) from units where society_id = v_society and is_billable) <> 30 then
    raise exception 'Expected 30 billable flats.';
  end if;
  select share_rounding_paise into v_rounding from society_settings where society_id = v_society;

  insert into event_series (society_id, title, description, scope_type, total_cost_paise, due_day, due_month_offset)
  values (v_society, c_title, 'Monthly security guard salary shared by all flats. Due by the 7th of the following month.',
          'all', c_share * 30, 7, 1)
  returning id into v_series;
  insert into event_series_versions (society_id, series_id, total_cost_paise, effective_period, reason)
  values (v_society, v_series, c_share * 30, c_start, 'Started');

  create temp table _sg_owe (unit_id uuid primary key, code text) on commit drop;
  v_period := c_start;
  while v_period <= c_last loop
    -- who owes this month (as billed before the Sep receipts)?
    truncate _sg_owe;
    insert into _sg_owe
    select u.id, u.code from units u
     where u.society_id = v_society and u.is_billable
       and (v_period = c_last                                       -- September: everyone is billed
            or u.code = any(v_never)
            or (v_partial -> u.code) ? v_period
            or (v_late ->> u.code) = v_period);
    select count(*) into v_exp from _sg_owe;
    continue when v_exp = 0;
    v_total := case when v_period = c_last then c_share * 30 else c_share * v_exp end;
    v_due := (make_date(substr(v_period, 1, 4)::int, substr(v_period, 6, 2)::int, 7) + interval '1 month')::date;

    insert into events (society_id, title, description, scope_type, total_cost_paise, rounding_paise, in_scope_count, expected_count,
                        per_unit_share_paise, due_date, series_id, series_period)
    values (v_society, c_title || ' – ' || public._period_label(v_period),
            case when v_period = c_last then null
                 else 'Pending amount carried forward from ' || public._period_label(v_period) || '. Payments before Sep 2026 are not tracked.' end,
            'all', v_total, v_rounding, 30, v_exp, public.event_share_paise(v_total, v_exp, v_rounding), v_due, v_series, v_period)
    returning id into v_event;
    if (select per_unit_share_paise from events where id = v_event) <> c_share then
      raise exception 'Per-flat share is not ₹800 for % (check the rounding setting).', v_period;
    end if;
    insert into event_units (event_id, unit_id, society_id, expected, exclusion_reason)
    select v_event, u.id, v_society, (o.unit_id is not null), case when o.unit_id is null then 'Paid before tracking began' end
      from units u left join _sg_owe o on o.unit_id = u.id
     where u.society_id = v_society and u.is_billable;
    perform public._open_event(v_event);
    select fund_id into v_fund from events where id = v_event;

    -- receipts that exist: all Sep payers, plus the late Aug payment
    for v_unit in select o.unit_id, o.code from _sg_owe o loop
      v_owes := (v_unit.code = any(v_never)) or ((v_partial -> v_unit.code) ? v_period);
      continue when v_owes and coalesce((v_late ->> v_unit.code) is distinct from v_period, true);
      perform public._post_unit_payment(v_society, v_unit.unit_id, v_fund, c_share, c_pay_date, c_mode, null,
        'Recorded from the society tally (' || public._period_label(v_period) || ')', null,
        'sg-' || v_unit.code || '-' || v_period, null, true, null);
      v_n := v_n + 1;
    end loop;
    v_period := to_char(public.period_start(v_period) + interval '1 month', 'YYYY-MM');
  end loop;

  -- the recurring event replaces monthly maintenance billing: switch it off and drop unpaid monthly dues
  update society_settings set monthly_dues_enabled = false where society_id = v_society;
  delete from dues d where d.society_id = v_society and d.due_type = 'monthly'
     and not exists (select 1 from due_allocations a where a.due_id = d.id);

  -- nobody is told about an old load
  delete from notifications where society_id = v_society and created_at >= v_start and kind in ('event_due', 'payment_received', 'surplus_payment');
  raise notice 'Done: % payments recorded.', v_n;
end $$;
