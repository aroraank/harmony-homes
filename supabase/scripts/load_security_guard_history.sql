-- Harmony Homes — one-time load of the Security guard collection history (Feb 2026 → Sep 2026).
-- Run ONCE in the Supabase SQL editor, after migrations up to 0008 are applied.
--
-- What it records (from the society tally of 8 Oct 2026):
--   * the recurring event "Security guard salary" (₹15,000 a month, 30 flats × ₹500, due on the 7th of the NEXT month)
--   * Feb–Aug 2026: ONLY the arrears that are still pending (one event per month, other flats marked
--     "Paid before tracking began"). Money collected earlier is deliberately not tracked.
--   * Sep 2026: all 30 flats are billed and the 21 payments received are recorded as real ledger entries
--   * P10-SF also paid Aug 2026 (received together with Sep) — recorded as a payment against the Aug event
--   * the daily job keeps publishing Oct 2026 onwards by itself
-- Safe to re-run: it stops if the series already exists. Nobody is notified by this script.

do $$
declare
  c_slug      constant text   := 'plot-colony';        -- society slug
  c_title     constant text   := 'Security guard salary';
  c_share     constant bigint := 50000;                -- ₹500 per flat, in paise
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
  v_missing text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_series' and column_name = 'due_month_offset') then
    raise exception 'The latest database update is missing. In your project folder run:  npx supabase db push   (migrations 0007 and 0008), then run this script again.';
  end if;
  select id into v_society from societies where slug = c_slug;
  if v_society is null then raise exception 'Society % not found', c_slug; end if;
  if exists (select 1 from event_series where society_id = v_society and title = c_title) then
    raise exception 'The recurring event "%" already exists — nothing was changed.', c_title;
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
      raise exception 'Per-flat share is not ₹500 for % (check the rounding setting).', v_period;
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

  -- nobody is told about an old load
  delete from notifications where society_id = v_society and created_at >= v_start and kind in ('event_due', 'payment_received', 'surplus_payment');
  raise notice 'Done: % payments recorded.', v_n;
end $$;
