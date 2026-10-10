-- READ-ONLY audit of payments, dues and funds. Changes nothing.
-- Run each query separately in the SQL Editor, then Export -> CSV and attach the 3 files.

-- ============ QUERY 1: every fund, what was billed, collected, spent, and its balance ============
select f.name as fund, f.kind, ev.series_period, ev.scope_type, ev.status, ev.due_date,
       (select count(*) from dues d where d.fund_id = f.id) as dues_count,
       (select count(*) from dues d where d.fund_id = f.id and d.waived) as waived_count,
       (select coalesce(sum(d.amount_paise), 0) / 100 from dues d where d.fund_id = f.id and not d.waived) as billed_rs,
       (select coalesce(sum(public.due_paid_paise(d.id)), 0) / 100 from dues d where d.fund_id = f.id) as paid_against_dues_rs,
       (select coalesce(sum(case when e.direction = 'debit' and e.category not in ('maintenance', 'event_contribution', 'transfer') then e.amount_paise end), 0) / 100
          from ledger_entries e where e.fund_id = f.id) as spent_rs,
       public.fund_balance_paise(f.id) / 100 as balance_rs,
       (select st.balance_from_period from society_settings st where st.society_id = f.society_id) as balance_from
  from funds f left join events ev on ev.id = f.event_id
 where f.society_id = (select society_id from units limit 1)
 order by ev.series_period nulls first, f.name;

-- ============ QUERY 2: every ledger entry, with the date it is dated vs the date it was actually typed in ============
select e.entry_date,
       (e.created_at at time zone 'Asia/Kolkata')::timestamp(0) as recorded_at_ist,
       u.code as flat, f.name as fund, e.category, e.direction, e.amount_paise / 100 as rs,
       e.payment_mode as mode, e.reference_no as ref, e.receipt_no,
       public._entry_for_label(e.id) as allocated_to,
       case when e.direction = 'credit' and e.unit_id is not null then public.entry_unallocated_paise(e.id) / 100 end as unallocated_rs,
       case when e.reverses_entry_id is not null then 'REVERSAL' when public.is_entry_reversed(e.id) then 'REVERSED' else '' end as rev,
       e.payee, e.note, e.backdate_reason, e.id
  from ledger_entries e join funds f on f.id = e.fund_id left join units u on u.id = e.unit_id
 where e.society_id = (select society_id from units limit 1)
 order by e.entry_date, e.created_at;

-- ============ QUERY 3: one row per flat, every month's status (paid date after @) ============
select u.code as flat, ut.name as flat_type,
       string_agg(coalesce(ev.series_period, left(ev.title, 18)) || ':' ||
         case when d.waived then 'WAIVED'
              when public.due_paid_paise(d.id) >= d.amount_paise then 'paid'
              when public.due_paid_paise(d.id) > 0 then 'PART'
              else 'DUE' end ||
         coalesce('@' || (select string_agg(distinct to_char(e.entry_date, 'MM-DD'), '/')
                            from due_allocations a join ledger_entries e on e.id = a.ledger_entry_id
                           where a.due_id = d.id and not public.is_entry_reversed(e.id)), ''),
         '  ' order by coalesce(ev.series_period, '9999'), ev.title) as months,
       (select coalesce(sum(public.entry_unallocated_paise(e.id)), 0) / 100 from ledger_entries e
         where e.unit_id = u.id and e.direction = 'credit' and e.reverses_entry_id is null
           and e.category in ('maintenance', 'event_contribution')) as advance_rs
  from units u join unit_types ut on ut.id = u.unit_type_id
  left join dues d on d.unit_id = u.id and d.due_type = 'event'
  left join events ev on ev.id = d.event_id
 where u.society_id = (select society_id from units limit 1)
 group by u.id, u.code, ut.name, u.sort_order
 order by u.sort_order, u.code;
