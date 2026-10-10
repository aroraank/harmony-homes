-- Harmony Homes — launch-day additions:
--   1. Members can acknowledge a pending-payment reminder popup; admins/super admins get notified when they do.
--   2. A one-time welcome popup after a member sets their own PIN for the first time (role-aware content).

-- ---------------------------------------------------------------------------
-- 1. Pending payment acknowledgement
-- ---------------------------------------------------------------------------
create table if not exists public.payment_acks (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references societies(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  pending_paise bigint not null,
  acknowledged_at timestamptz not null default now()
);
create index if not exists payment_acks_unit_idx on public.payment_acks(unit_id, acknowledged_at desc);

alter table public.payment_acks enable row level security;

drop policy if exists payment_acks_read on public.payment_acks;
create policy payment_acks_read on public.payment_acks for select
  using (unit_id in (select public.my_unit_ids(society_id)) or public.is_admin(society_id));

-- Member confirms they've seen the pending-payment popup for their flat; admins who can record
-- payments are notified so they know the resident is aware of the dues.
create or replace function public.acknowledge_pending_payment(p_unit_id uuid, p_pending_paise bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_society uuid; v_code text; v_name text;
begin
  select society_id into v_society from units where id = p_unit_id;
  if v_society is null then
    raise exception using errcode = 'P0001', message = 'Flat not found.';
  end if;
  perform public.assert_member(v_society);
  if p_unit_id not in (select public.my_unit_ids(v_society)) then
    raise exception using errcode = '42501', message = 'You can only acknowledge your own flat''s dues.';
  end if;
  if p_pending_paise is null or p_pending_paise < 0 then
    raise exception using errcode = 'P0001', message = 'Invalid amount.';
  end if;
  insert into payment_acks (society_id, unit_id, user_id, pending_paise) values (v_society, p_unit_id, auth.uid(), p_pending_paise);
  select code, display_name into v_code, v_name from units where id = p_unit_id;
  perform public._notify(v_society, public._perm_user_ids(v_society, 'record_payment'), 'payment_ack', p_unit_id,
    format('%s acknowledged a pending payment of %s', coalesce(v_code, v_name), public.fmt_inr(p_pending_paise)),
    'They have seen the reminder on their Home screen.', '/reports/unit/' || p_unit_id);
end $$;
grant execute on function public.acknowledge_pending_payment(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. One-time welcome popup
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists welcomed_at timestamptz;

create or replace function public.mark_welcomed() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in again.';
  end if;
  update profiles set welcomed_at = now() where id = auth.uid() and welcomed_at is null;
end $$;
grant execute on function public.mark_welcomed() to authenticated;
