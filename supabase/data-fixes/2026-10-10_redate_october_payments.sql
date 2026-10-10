-- ONE-TIME DATA FIX (not a migration — never run on a fresh database).
-- 22 cash payments (₹17,600) from the society tally were dated 30 Sep 2026, but were received in October 2026.
--   21 × Security guard salary – September 2026 + 1 × August 2026 (P10-SF).
-- For each one, in ONE transaction:
--   1. a cancellation entry on 30 Sep (September nets back to ₹0 — nothing is deleted, the history stays),
--   2. the same payment re-recorded on the October date below, with a fresh receipt,
--   3. allocated back to the SAME month's due it paid before (month statuses do not change).
-- No notifications are sent. If any check fails, NOTHING is changed. Running it twice does nothing the 2nd time.

do $fix$
declare
  v_date constant date := date '2026-10-08';   -- date printed on the new receipts (the day the tally was handed over)
  v_ids constant uuid[] := array[
    '9412fa0f-42b8-43cb-baf9-e6e967238f5b', -- P12-FF Sep
    'c0fd537f-6c16-46d3-8aae-88a589954afc', -- P1-SF  Sep
    '685ae586-af35-4897-bfac-c6948a820630', -- P11-FF Sep
    '853ca0f8-8a14-421c-a968-85aff06c2ddb', -- P12-GF Sep
    'aa57c5e2-1a26-400f-9f8c-5cbcddb34c5d', -- P1-FF  Sep
    '89ee484d-3768-42a7-9168-730cfcb0ddc7', -- P2-SF  Sep
    '7714ffab-b7c2-4444-99f6-90dfdbdcb190', -- P3-GF  Sep
    '7910a330-a1a2-4961-b3cb-17a82e9081b2', -- P3-SF  Sep
    '337934dc-e0cf-4f89-87f7-c80937c8d910', -- P4-GF  Sep
    '0f1e4d47-46db-4d8a-8c07-4a2d12f1ab44', -- P4-SF  Sep
    'e8a32e42-84c5-4f30-83bd-afa00b6cc72b', -- P5-FF  Sep
    '0ec801e4-70d1-4189-89f5-78dcf1086ccd', -- P6-GF  Sep
    'e7e1f7fa-b192-457e-9620-72092e81a1db', -- P6-FF  Sep
    '4918d3ad-55cc-4eee-9b91-58c0397916fb', -- P6-SF  Sep
    'bf9ecfb5-508c-49bc-9f6a-cd5c26aa4abd', -- P9-GF  Sep
    '2587cd10-17c5-4362-89b7-ed0ef84694be', -- P9-FF  Sep
    'ea7d3d03-7233-47df-a07c-e1f00e9374cc', -- P9-SF  Sep
    'fef27dce-ef46-41fc-a3c2-280d6b0e0899', -- P10-GF Sep
    '695fe203-4bea-40a3-bbc6-759007ea572a', -- P10-FF Sep
    'c6941918-f834-457f-b67e-577c22068234', -- P10-SF Sep
    '923a52c6-4da8-4623-a392-e7613c7dbe93', -- P10-SF Aug
    'dd4daf5f-0acf-493b-b08d-2a743bfa6f3a'  -- P11-GF Sep
  ]::uuid[];
  v_society uuid;
  e record;
  v_new uuid;
  v_n int := 0;
  v_done int;
begin
  if cardinality(v_ids) <> 22 then raise exception 'Expected 22 ids.'; end if;

  -- already applied? then do nothing
  select count(*) into v_done from ledger_entries where reverses_entry_id = any(v_ids);
  if v_done = 22 then raise notice 'Already applied earlier — nothing to do.'; return; end if;
  if v_done <> 0 then raise exception 'Only % of 22 were corrected before. Stop and send this message to the developer.', v_done; end if;

  -- the 22 rows must be exactly what the audit showed
  if (select count(*) from ledger_entries
       where id = any(v_ids) and entry_date = date '2026-09-30' and direction = 'credit'
         and amount_paise = 80000 and category = 'event_contribution'
         and reverses_entry_id is null and unit_id is not null) <> 22 then
    raise exception 'The 22 payments are not exactly as audited. Nothing changed.';
  end if;
  select distinct society_id into strict v_society from ledger_entries where id = any(v_ids);

  if v_date < date '2026-10-01' or v_date > public.ist_today() then
    raise exception 'The new date must be in October 2026 and not in the future. Nothing changed.';
  end if;
  if public.is_month_closed(v_society, '2026-09') or public.is_month_closed(v_society, public.period_of(v_date)) then
    raise exception 'September or October 2026 is closed. Reopen it first. Nothing changed.';
  end if;

  for e in select * from ledger_entries where id = any(v_ids) order by receipt_no loop
    -- 1. cancel the wrongly dated entry on its own date
    insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id,
                                payment_mode, note, created_by, reverses_entry_id, idempotency_key)
    values (e.society_id, e.fund_id, e.entry_date, 'debit', e.amount_paise, e.category, e.unit_id,
            e.payment_mode,
            'Reversal: Correction — received in October 2026, not September. Re-recorded on '
              || to_char(v_date, 'DD Mon YYYY') || '.',
            e.created_by, e.id, 'oct-redate:' || e.id || ':1');

    -- 2. the same payment on its real October date, with a fresh receipt
    insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id,
                                payment_mode, reference_no, note, created_by, receipt_no, receipt_token, idempotency_key)
    values (e.society_id, e.fund_id, v_date, 'credit', e.amount_paise, e.category, e.unit_id,
            e.payment_mode, e.reference_no,
            'Received in October 2026 (society tally). Replaces receipt ' || coalesce(e.receipt_no, '-') || '.',
            e.created_by, public._next_receipt_no(e.society_id, v_date),
            upper(encode(extensions.gen_random_bytes(6), 'hex')), 'oct-redate:' || e.id)
    returning id into v_new;

    -- 3. settle the same month's due again (each flat has one due per month, so this is exact)
    perform public._allocate(e.unit_id, e.fund_id);
    if public.entry_unallocated_paise(v_new) <> 0 then
      raise exception 'Payment % did not settle its month. Nothing changed.', e.receipt_no;
    end if;
    v_n := v_n + 1;
  end loop;

  if v_n <> 22 then raise exception 'Only % processed. Nothing changed.', v_n; end if;
end $fix$;


-- ============ CHECK (read-only) — run after the fix ============
-- Expected: 2026-09 → 0   and   2026-10 → 20000
select public.period_of(entry_date) as month,
       sum(case when direction = 'credit' then amount_paise else -amount_paise end) / 100 as net_rs
  from ledger_entries where society_id = (select society_id from units limit 1)
 group by 1 order by 1;
