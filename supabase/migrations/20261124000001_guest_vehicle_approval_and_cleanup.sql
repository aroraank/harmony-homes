-- Harmony Homes — 2026-11-24 batch
--   1. Guest vehicle approval: a guest vehicle no longer walks straight in. The flat it is
--      visiting is notified and must approve before the guard lets it through. The guard can
--      also approve on the resident's behalf when they have already confirmed by phone.
--   2. Deleting a recurring expense head ("Submersible" etc.) now voids every ledger entry that
--      head ever produced, so nothing it ever paid stays visible anywhere in the ledger.
--   3. Archiving an event (used right now for "Motor repair — 3BHK") voids its ledger entries,
--      waives its unpaid dues and drops it out of the events list, the ledger and the society
--      position/surplus boards — without ever touching an immutable ledger row in place.

-- ---------------------------------------------------------------------------
-- 0. A reversible "void" for ledger entries that never UPDATEs/DELETEs a row.
--    Every entry is immutable (see forbid_mutation()); the only way to make one disappear
--    from view is to post an offsetting entry and hide the pair. void_kind marks that pair as
--    a hard cleanup (as opposed to an ordinary visible reversal from reverse_entry()).
-- ---------------------------------------------------------------------------
alter table public.ledger_entries
  add column if not exists void_kind text check (void_kind in ('event_archived', 'head_removed'));

create or replace function public._void_ledger_entries(p_entry_ids uuid[], p_kind text, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare leg record; v_n int := 0; v_new uuid;
begin
  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then return 0; end if;
  for leg in
    select * from ledger_entries where id = any(p_entry_ids) and reverses_entry_id is null for update
  loop
    if public.is_entry_reversed(leg.id) then continue; end if;
    insert into ledger_entries (society_id, fund_id, entry_date, direction, amount_paise, category, unit_id, payee,
                                payment_mode, note, created_by, reverses_entry_id, void_kind)
    values (leg.society_id, leg.fund_id, leg.entry_date,
            case when leg.direction = 'credit' then 'debit' else 'credit' end,
            leg.amount_paise, leg.category, leg.unit_id, leg.payee, leg.payment_mode,
            left(coalesce(p_reason, 'Removed'), 500), auth.uid(), leg.id, p_kind)
    returning id into v_new;
    v_n := v_n + 1;
    if leg.unit_id is not null and leg.category in ('maintenance', 'event_contribution') then
      perform public._allocate(leg.unit_id, leg.fund_id);
    end if;
  end loop;
  return v_n;
end $$;

-- v_ledger is the only place clients read entries directly (LedgerPage) — hide voided pairs there.
create or replace view public.v_ledger with (security_invoker = true) as
select
  e.id, e.society_id, e.fund_id, f.name as fund_name, f.kind as fund_kind, e.entry_date, e.direction, e.amount_paise,
  e.category, e.unit_id, u.code as unit_code, e.payee, e.payment_mode, e.reference_no, e.note, e.attachment_path,
  e.created_by, p.full_name as created_by_name, e.created_at, e.reverses_entry_id, e.transfer_group, e.receipt_no,
  e.receipt_token, e.claim_id, e.backdate_reason,
  public.is_entry_reversed(e.id) as is_reversed,
  (select r.note from public.ledger_entries r where r.reverses_entry_id = e.id limit 1) as reversal_note,
  case when e.direction = 'credit' then e.amount_paise else -e.amount_paise end as signed_paise
from public.ledger_entries e
join public.funds f on f.id = e.fund_id
left join public.units u on u.id = e.unit_id
left join public.profiles p on p.id = e.created_by
where e.void_kind is null
  and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = e.id and r.void_kind is not null);

-- ---------------------------------------------------------------------------
-- 1. Delete a recurring expense head completely (e.g. "Submersible")
-- ---------------------------------------------------------------------------
create or replace function public.delete_expense_template(p_society uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text; v_ids uuid[]; v_voided int;
begin
  perform public.assert_super_admin(p_society);
  select title into v_title from expense_templates where id = p_id and society_id = p_society;
  if v_title is null then
    raise exception using errcode = 'P0001', message = 'Recurring expense not found.';
  end if;
  select coalesce(array_agg(ledger_entry_id), '{}') into v_ids
    from expense_drafts where template_id = p_id and ledger_entry_id is not null;
  v_voided := public._void_ledger_entries(v_ids, 'head_removed', format('"%s" expense head removed', v_title));
  delete from expense_templates where id = p_id and society_id = p_society;
  return jsonb_build_object('deleted', true, 'entries_voided', v_voided);
end $$;
revoke execute on function public.delete_expense_template(uuid, uuid) from public, anon;
grant execute on function public.delete_expense_template(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Archive an event completely (e.g. "Motor repair — 3BHK")
-- ---------------------------------------------------------------------------
alter table public.events
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id),
  add column if not exists archive_reason text check (archive_reason is null or char_length(archive_reason) <= 300);

create or replace function public.archive_event(p_event_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ev record; v_ids uuid[]; v_voided int := 0; v_waived int := 0; d record;
begin
  select * into ev from events where id = p_event_id;
  if not found then raise exception using errcode = 'P0001', message = 'Event not found.'; end if;
  perform public.assert_super_admin(ev.society_id);
  if ev.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'Already removed.';
  end if;
  if ev.fund_id is not null then
    select coalesce(array_agg(id), '{}') into v_ids
      from ledger_entries where fund_id = ev.fund_id and reverses_entry_id is null;
    v_voided := public._void_ledger_entries(v_ids, 'event_archived', format('"%s" event removed', ev.title));
  end if;
  for d in select * from dues where event_id = p_event_id and not waived loop
    update dues set waived = true, waived_reason = left(coalesce(p_reason, 'Event removed'), 300),
           waived_by = auth.uid(), waived_at = now()
     where id = d.id;
    v_waived := v_waived + 1;
  end loop;
  update events
     set archived_at = now(), archived_by = auth.uid(), archive_reason = left(p_reason, 300),
         status = 'closed', closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, auth.uid())
   where id = p_event_id;
  return jsonb_build_object('archived', true, 'entries_voided', v_voided, 'dues_waived', v_waived);
end $$;
revoke execute on function public.archive_event(uuid, text) from public, anon;
grant execute on function public.archive_event(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Guest vehicle approval flow
-- ---------------------------------------------------------------------------
alter table public.gate_visits
  add column if not exists approval_status text not null default 'auto'
    check (approval_status in ('auto', 'pending', 'approved', 'denied')),
  add column if not exists approved_by uuid references public.profiles(id),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_via text check (approved_via in ('resident', 'guard_override')),
  add column if not exists approval_note text check (approval_note is null or char_length(approval_note) <= 200);

create index if not exists gate_visits_pending_idx on public.gate_visits(society_id, unit_id)
  where approval_status = 'pending' and out_at is null;

-- A guest vehicle for a known flat now waits for approval instead of walking straight in.
drop function if exists public.gate_check_in(uuid, text, uuid, text, text);
create or replace function public.gate_check_in(
  p_society uuid, p_plate text, p_unit_id uuid, p_note text default null, p_kind text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plate text := public.norm_plate(p_plate);
  v_id uuid; v_code text; v_open timestamptz; v_status text := 'auto';
begin
  perform public.assert_gate_user(p_society);
  if p_kind is not null and p_kind not in ('car', 'bike', 'scooter', 'truck', 'other') then
    raise exception using errcode = 'P0001', message = 'Choose a vehicle type.';
  end if;
  select u.code into v_code from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  if v_code is not null then
    raise exception using errcode = 'P0001',
      message = format('%s belongs to %s. No entry is needed for society vehicles.', v_plate, v_code);
  end if;
  select in_at into v_open from gate_visits
   where society_id = p_society and plate = v_plate and out_at is null limit 1;
  if v_open is not null then
    raise exception using errcode = 'P0001', message = 'This vehicle is already marked IN. Mark it OUT first.';
  end if;
  if p_unit_id is not null and not exists (select 1 from units where id = p_unit_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Choose a flat from the list.';
  end if;
  if p_unit_id is not null then v_status := 'pending'; end if;
  insert into gate_visits (society_id, plate, plate_text, unit_id, in_by, note, kind, approval_status)
  values (p_society, v_plate, coalesce(public.plate_text(p_plate), v_plate), p_unit_id, auth.uid(),
          left(public.clean_text(p_note), 120), p_kind, v_status)
  returning id into v_id;
  if v_status = 'pending' then
    perform public._notify(p_society, public._unit_user_ids(p_unit_id), 'vehicle_approval', v_id,
      format('Guest vehicle %s is at the gate', coalesce(public.plate_text(p_plate), v_plate)),
      'Open to approve it in, or keep it out.',
      '/vehicles/approve/' || v_id);
  end if;
  return jsonb_build_object('id', v_id, 'plate', v_plate, 'approval_status', v_status);
end $$;
revoke execute on function public.gate_check_in(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.gate_check_in(uuid, text, uuid, text, text) to authenticated;

create or replace function public.gate_lookup(p_society uuid, p_plate text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_plate text := public.norm_plate(p_plate); v_res jsonb; v_open jsonb; v_last jsonb;
begin
  perform public.assert_gate_user(p_society);
  select jsonb_build_object('vehicle_id', v.id, 'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
                            'kind', v.kind, 'model', v.model, 'color', v.color, 'plate_text', v.plate_text)
    into v_res
    from vehicles v join units u on u.id = v.unit_id
   where v.society_id = p_society and v.plate = v_plate limit 1;
  select jsonb_build_object('id', g.id, 'in_at', g.in_at, 'unit_id', g.unit_id, 'unit_code', u.code,
                            'unit_name', u.display_name, 'plate_text', g.plate_text, 'note', g.note, 'kind', g.kind,
                            'approval_status', g.approval_status)
    into v_open
    from gate_visits g left join units u on u.id = g.unit_id
   where g.society_id = p_society and g.plate = v_plate and g.out_at is null limit 1;
  select jsonb_build_object('in_at', g.in_at, 'out_at', g.out_at, 'unit_code', u.code, 'unit_name', u.display_name)
    into v_last
    from gate_visits g left join units u on u.id = g.unit_id
   where g.society_id = p_society and g.plate = v_plate and g.out_at is not null
   order by g.in_at desc limit 1;
  return jsonb_build_object('plate', v_plate, 'plate_text', coalesce(public.plate_text(p_plate), v_plate),
                            'resident', v_res, 'open_visit', v_open, 'last_visit', v_last);
end $$;

-- "Inside" now only counts entries that were actually let in; "awaiting" is the guard's own queue.
create or replace function public.gate_board(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open jsonb; v_recent jsonb; v_awaiting jsonb; v_in_today int;
begin
  perform public.assert_gate_user(p_society);
  select coalesce(jsonb_agg(x order by x->>'in_at' desc), '[]'::jsonb) into v_open from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note, 'kind', g.kind) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is null and g.approval_status in ('auto', 'approved')) s;
  select coalesce(jsonb_agg(x order by x->>'in_at'), '[]'::jsonb) into v_awaiting from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note, 'kind', g.kind) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is null and g.approval_status = 'pending') s;
  select coalesce(jsonb_agg(x order by x->>'out_at' desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('id', g.id, 'plate_text', g.plate_text, 'in_at', g.in_at, 'out_at', g.out_at,
                              'unit_code', u.code, 'unit_name', u.display_name, 'kind', g.kind,
                              'approval_status', g.approval_status) x
      from gate_visits g left join units u on u.id = g.unit_id
     where g.society_id = p_society and g.out_at is not null and g.out_at > now() - interval '12 hours'
     order by g.out_at desc limit 15) s;
  select count(*) into v_in_today from gate_visits
   where society_id = p_society and (in_at at time zone 'Asia/Kolkata')::date = public.ist_today();
  return jsonb_build_object('inside', v_open, 'awaiting', v_awaiting, 'recent_out', v_recent, 'in_today', v_in_today,
                            'society_name', (select name from societies where id = p_society));
end $$;

-- A resident approves/denies their own flat's guest vehicle; a guard/admin may also approve or
-- deny on their behalf when they have already confirmed it by phone (p_via = 'guard_override').
create or replace function public.approve_gate_visit(
  p_visit_id uuid, p_decision text, p_via text default 'resident', p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_decision not in ('approve', 'deny') then
    raise exception using errcode = 'P0001', message = 'Invalid decision.';
  end if;
  if p_via not in ('resident', 'guard_override') then
    raise exception using errcode = 'P0001', message = 'Invalid approval method.';
  end if;
  select * into v from gate_visits where id = p_visit_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Entry not found.'; end if;
  if v.approval_status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'This has already been decided.';
  end if;
  if v.out_at is not null then
    raise exception using errcode = 'P0001', message = 'This vehicle has already left.';
  end if;
  if p_via = 'resident' then
    perform public.assert_member(v.society_id);
    if not (public.is_admin(v.society_id) or v.unit_id in (select public.my_unit_ids(v.society_id))) then
      raise exception using errcode = '42501', message = 'This is not your flat''s gate entry.';
    end if;
  else
    perform public.assert_gate_user(v.society_id);
    if char_length(coalesce(public.clean_text(p_note), '')) < 3 then
      raise exception using errcode = 'P0001', message = 'Say how you confirmed it, e.g. spoke on the phone.';
    end if;
  end if;
  update gate_visits
     set approval_status = case when p_decision = 'approve' then 'approved' else 'denied' end,
         approved_by = auth.uid(), approved_at = now(), approved_via = p_via,
         approval_note = left(public.clean_text(p_note), 200),
         out_at = case when p_decision = 'deny' then now() else out_at end,
         out_by = case when p_decision = 'deny' then auth.uid() else out_by end
   where id = p_visit_id;
  if p_via = 'guard_override' and v.unit_id is not null then
    perform public._notify(v.society_id, public._unit_user_ids(v.unit_id), 'vehicle_approval_resolved', v.id,
      format('%s — %s', v.plate_text, case when p_decision = 'approve' then 'let in by the guard' else 'kept out by the guard' end),
      'The guard said they had already spoken with you on the phone.', '/vehicles');
  end if;
  return jsonb_build_object('id', v.id, 'approval_status', case when p_decision = 'approve' then 'approved' else 'denied' end);
end $$;
revoke execute on function public.approve_gate_visit(uuid, text, text, text) from public, anon;
grant execute on function public.approve_gate_visit(uuid, text, text, text) to authenticated;

-- Every guest vehicle waiting on this member's own flat(s) (or, for an admin, the whole society) —
-- used for the "waiting for your approval" banner shown first on the home page.
create or replace function public.my_vehicle_approvals(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'plate_text', g.plate_text, 'kind', g.kind, 'in_at', g.in_at,
             'unit_id', g.unit_id, 'unit_code', u.code, 'unit_name', u.display_name, 'note', g.note)
           order by g.in_at)
      from gate_visits g join units u on u.id = g.unit_id
     where g.society_id = p_society and g.approval_status = 'pending' and g.out_at is null
       and (public.is_admin(p_society) or g.unit_id in (select public.my_unit_ids(p_society)))
  ), '[]'::jsonb);
end $$;
revoke execute on function public.my_vehicle_approvals(uuid) from public, anon;
grant execute on function public.my_vehicle_approvals(uuid) to authenticated;

-- One guest vehicle's approval card (the page the push notification links to).
create or replace function public.vehicle_approval_detail(p_visit_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select g.*, u.code as unit_code, u.display_name as unit_name into v
    from gate_visits g join units u on u.id = g.unit_id where g.id = p_visit_id;
  if not found then raise exception using errcode = 'P0001', message = 'Entry not found.'; end if;
  perform public.assert_member(v.society_id);
  if not (public.is_admin(v.society_id) or v.unit_id in (select public.my_unit_ids(v.society_id))) then
    raise exception using errcode = '42501', message = 'This is not your flat''s gate entry.';
  end if;
  return jsonb_build_object('id', v.id, 'plate_text', v.plate_text, 'kind', v.kind, 'in_at', v.in_at,
    'unit_code', v.unit_code, 'unit_name', v.unit_name, 'note', v.note, 'approval_status', v.approval_status,
    'out_at', v.out_at);
end $$;
revoke execute on function public.vehicle_approval_detail(uuid) from public, anon;
grant execute on function public.vehicle_approval_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Vehicle gate log — searchable history for the owner, the admin/super-admin, and the guard.
--    A resident only ever sees their own flat's entries; the guard and admin/super-admin see
--    the whole society and can additionally filter by flat. Every row carries who approved it,
--    when, how (resident / guard phone-override, with the guard's note), and how long it waited.
-- ---------------------------------------------------------------------------
create or replace function public.gate_visit_log(
  p_society uuid, p_plate text default null, p_unit_id uuid default null,
  p_since timestamptz default null, p_limit int default 50, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_plate text := case when p_plate is not null and length(trim(p_plate)) > 0 then public.norm_plate(p_plate) end;
  v_full boolean;
  v_rows jsonb;
  v_total int;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in again.';
  end if;
  v_full := public.is_guard(p_society) or public.is_admin(p_society);
  if not v_full then
    if not public.is_member(p_society) then
      raise exception using errcode = '42501', message = 'You do not have permission to do this.';
    end if;
    if p_unit_id is not null and p_unit_id not in (select public.my_unit_ids(p_society)) then
      raise exception using errcode = '42501', message = 'This is not your flat.';
    end if;
  end if;

  select count(*) into v_total
    from gate_visits g
   where g.society_id = p_society
     and (v_plate is null or g.plate = v_plate)
     and (p_since is null or g.in_at >= p_since)
     and (v_full or g.unit_id in (select public.my_unit_ids(p_society)))
     and (p_unit_id is null or g.unit_id = p_unit_id);

  select coalesce(jsonb_agg(x order by x->>'in_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
             'id', g.id, 'plate_text', g.plate_text, 'kind', g.kind,
             'in_at', g.in_at, 'out_at', g.out_at,
             'unit_id', g.unit_id, 'unit_code', u.code, 'unit_name', u.display_name,
             'note', g.note, 'approval_status', g.approval_status,
             'approved_by_name', ap.full_name, 'approved_at', g.approved_at,
             'approved_via', g.approved_via, 'approval_note', g.approval_note,
             'in_by_name', ib.full_name,
             'waited_seconds', case
               when g.approval_status = 'pending' then extract(epoch from (now() - g.in_at))::int
               when g.approved_at is not null then extract(epoch from (g.approved_at - g.in_at))::int
               else null
             end
           ) x
      from gate_visits g
      left join units u on u.id = g.unit_id
      left join profiles ap on ap.id = g.approved_by
      left join profiles ib on ib.id = g.in_by
     where g.society_id = p_society
       and (v_plate is null or g.plate = v_plate)
       and (p_since is null or g.in_at >= p_since)
       and (v_full or g.unit_id in (select public.my_unit_ids(p_society)))
       and (p_unit_id is null or g.unit_id = p_unit_id)
     order by g.in_at desc
     limit v_limit offset v_offset
  ) s;
  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'role',
                            case when public.is_guard(p_society) then 'guard'
                                 when public.is_admin(p_society) then 'admin' else 'resident' end);
end $$;
revoke execute on function public.gate_visit_log(uuid, text, uuid, timestamptz, int, int) from public, anon;
grant execute on function public.gate_visit_log(uuid, text, uuid, timestamptz, int, int) to authenticated;

-- Flats list for the admin/super-admin "filter by flat" dropdown (plain code + name, no PII).
create or replace function public.society_unit_options(p_society uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', display_name) order by code), '[]'::jsonb)
    from units where society_id = p_society
$$;
revoke execute on function public.society_unit_options(uuid) from public, anon;
grant execute on function public.society_unit_options(uuid) to authenticated;

-- Gate-visit rows older than p_keep_days are deleted for good, same idiom as purge_old_notifications().
-- 30 days of history is plenty for a security question; nothing here is financial, so this one job can
-- safely be run automatically without a human in the loop.
create or replace function public.purge_old_gate_visits(p_keep_days int default 30) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_keep_days < 15 then raise exception using errcode = 'P0001', message = 'Keep at least 15 days.'; end if;
  delete from public.gate_visits where in_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end $$;
revoke execute on function public.purge_old_gate_visits(int) from public, anon, authenticated;
grant execute on function public.purge_old_gate_visits(int) to service_role;

-- Every day at 03:15 IST (21:45 UTC).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('hh-purge-gate-visits', '45 21 * * *', $c$ select public.purge_old_gate_visits(30); $c$);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Who approves fastest / slowest — only counts a flat's OWN decisions (approved_via = 'resident'),
--    never a guard's phone-override, since an override measures the guard, not the flat. A flat needs
--    at least 2 of its own decisions before it shows up anywhere, so one lucky/unlucky response can't
--    brand it.
-- ---------------------------------------------------------------------------

-- Admin/super-admin report: every flat's average response time, slowest first (who to nudge),
-- and each one's fastest/slowest single response.
create or replace function public.vehicle_approval_stats(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_member(p_society);
  if not public.is_admin(p_society) then
    raise exception using errcode = '42501', message = 'Only an admin can see this.';
  end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'avg_wait_seconds')::int desc) from (
      select jsonb_build_object(
               'unit_id', u.id, 'unit_code', u.code, 'unit_name', u.display_name,
               'decisions', count(*),
               'avg_wait_seconds', round(avg(extract(epoch from (g.approved_at - g.in_at))))::int,
               'fastest_seconds', round(min(extract(epoch from (g.approved_at - g.in_at))))::int,
               'slowest_seconds', round(max(extract(epoch from (g.approved_at - g.in_at))))::int,
               'last_decided_at', max(g.approved_at)
             ) x
        from gate_visits g join units u on u.id = g.unit_id
       where g.society_id = p_society and g.approved_via = 'resident'
         and g.approval_status in ('approved', 'denied')
       group by u.id, u.code, u.display_name
      having count(*) >= 2
    ) s
  ), '[]'::jsonb);
end $$;
revoke execute on function public.vehicle_approval_stats(uuid) from public, anon;
grant execute on function public.vehicle_approval_stats(uuid) to authenticated;

-- A resident's own "fun fact": their average response time, and — only ever the flats that are
-- QUICKER than them, never the slower ones — so nobody is shown as the slow one by name.
create or replace function public.my_approval_speed(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_unit_id uuid; v_n int; v_avg int; v_faster jsonb;
begin
  perform public.assert_member(p_society);
  select unit_id into v_unit_id from memberships
   where user_id = auth.uid() and society_id = p_society and status = 'active' and unit_id is not null
   limit 1;
  if v_unit_id is null then
    return jsonb_build_object('eligible', false);
  end if;

  select count(*), round(avg(extract(epoch from (approved_at - in_at))))::int into v_n, v_avg
    from gate_visits
   where society_id = p_society and unit_id = v_unit_id
     and approved_via = 'resident' and approval_status in ('approved', 'denied');

  if v_n is null or v_n < 2 then
    return jsonb_build_object('eligible', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('unit_code', z.unit_code, 'unit_name', z.unit_name,
                                                'avg_seconds', z.avg_seconds) order by z.avg_seconds), '[]'::jsonb)
    into v_faster
    from (
      select y.unit_code, y.unit_name, y.avg_seconds
        from (
          select u.code as unit_code, u.display_name as unit_name,
                 round(avg(extract(epoch from (g.approved_at - g.in_at))))::int as avg_seconds
            from gate_visits g join units u on u.id = g.unit_id
           where g.society_id = p_society and g.approved_via = 'resident'
             and g.approval_status in ('approved', 'denied') and g.unit_id <> v_unit_id
           group by u.id, u.code, u.display_name
          having count(*) >= 2
        ) y
       where y.avg_seconds < v_avg
       order by y.avg_seconds
       limit 10
    ) z;

  return jsonb_build_object('eligible', true, 'my_avg_seconds', v_avg, 'my_decisions', v_n,
                            'faster_flats', v_faster, 'faster_count', jsonb_array_length(v_faster));
end $$;
revoke execute on function public.my_approval_speed(uuid) from public, anon;
grant execute on function public.my_approval_speed(uuid) to authenticated;
