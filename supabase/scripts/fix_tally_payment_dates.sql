-- Harmony Homes — give the payments loaded from the society tally their real month.
-- The history loader dated every payment on the day it ran (8 Oct 2026), so a September statement showed nothing.
-- Edit c_sep_date / c_aug_date below (the day the money was really received, or the last day of that month),
-- then run in the Supabase SQL editor. Only entries created by the loader are touched, and the change is logged.
do $$
declare
  c_slug     constant text := 'plot-colony';
  c_sep_date constant date := date '2026-09-30';   -- date to show for September payments
  c_aug_date constant date := date '2026-09-30';   -- the late August payment (P10-SF), received with September
  v_society uuid; v_n int;
begin
  select id into v_society from societies where slug = c_slug;
  if v_society is null then raise exception 'Society % not found', c_slug; end if;
  if c_sep_date > public.ist_today() or c_aug_date > public.ist_today() then raise exception 'Dates cannot be in the future.'; end if;
  alter table public.ledger_entries disable trigger user;
  update ledger_entries set entry_date = case when note like '%(August 2026)%' then c_aug_date else c_sep_date end
   where society_id = v_society and created_by is null and note like 'Recorded from the society tally%'
     and (note like '%(September 2026)%' or note like '%(August 2026)%');
  get diagnostics v_n = row_count;
  alter table public.ledger_entries enable trigger user;
  perform audit_append(v_society, 'history_redate', 'ledger_entries', 'tally', null,
    jsonb_build_object('entries', v_n, 'sep_date', c_sep_date, 'aug_date', c_aug_date));
  raise notice 'Done: % payments re-dated.', v_n;
end $$;
