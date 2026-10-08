-- Harmony Homes — recurring events (auto-published each month), amount history for fixed monthly expenses
-- and recurring events, "from this month / from next month" changes, notices to everyone, and an events overview
-- (last 3 events + month/year filter with shortfall / surplus).

create or replace function public._all_member_ids(p_society uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct user_id), '{}') from memberships where society_id = p_society and status = 'active'
$$;
revoke execute on function public._all_member_ids(uuid) from public, anon, authenticated;

create or replace function public._next_period() returns text
language sql stable set search_path = public as $$
  select public.period_of((date_trunc('month', public.ist_today()) + interval '1 month')::date)
$$;

create or replace function public._period_label(p text) returns text
language sql immutable set search_path = public as $$
  select to_char(public.period_start(p), 'FMMonth YYYY')
$$;

-- ---------------------------------------------------------------------------
-- 1. Fixed monthly expenses: amount history + scheduled change
-- ---------------------------------------------------------------------------
alter table public.expense_templates
  add column if not exists pending_amount_paise bigint check (pending_amount_paise is null or (pending_amount_paise > 0 and pending_amount_paise <= 1000000000)),
  add column if not exists pending_from_period text check (pending_from_period is null or public.is_valid_period(pending_from_period));

create table if not exists public.expense_template_versions (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  template_id uuid not null references public.expense_templates(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  effective_period text not null check (public.is_valid_period(effective_period)),
  reason text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists etv_template_idx on public.expense_template_versions(template_id, changed_at);

insert into public.expense_template_versions (society_id, template_id, amount_paise, effective_period, reason, changed_at)
select society_id, id, amount_paise, public.period_of((created_at at time zone 'Asia/Kolkata')::date), 'Started', created_at
  from public.expense_templates t
 where not exists (select 1 from public.expense_template_versions v where v.template_id = t.id);

create or replace function public._template_amount_for(p_template uuid, p_period text) returns bigint
language sql stable security definer set search_path = public as $$
  select case when pending_from_period is not null and p_period >= pending_from_period then pending_amount_paise else amount_paise end
    from expense_templates where id = p_template
$$;
revoke execute on function public._template_amount_for(uuid, text) from public, anon, authenticated;

create or replace function public._generate_expense_drafts(p_society uuid, p_period text, p_only_due boolean) returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  insert into expense_drafts (society_id, template_id, period, amount_paise)
  select t.society_id, t.id, p_period, public._template_amount_for(t.id, p_period)
    from expense_templates t
   where t.society_id = p_society and t.is_active
     and (not p_only_due or p_period < public.period_of(public.ist_today())
          or t.day_of_month <= extract(day from public.ist_today()))
  on conflict (template_id, period) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The amount is no longer edited in place: it goes through change_template_amount so history is kept.
create or replace function public.upsert_expense_template(
  p_society uuid, p_id uuid, p_title text, p_fund_id uuid, p_category text, p_payee text,
  p_amount_paise bigint, p_day_of_month int, p_payment_mode text, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; old record;
begin
  perform public.assert_perm(p_society, 'record_expense');
  if char_length(coalesce(public.clean_text(p_title), '')) < 2 then
    raise exception using errcode = 'P0001', message = 'Title is required.';
  end if;
  if not exists (select 1 from funds where id = p_fund_id and society_id = p_society) then
    raise exception using errcode = 'P0001', message = 'Fund not found.';
  end if;
  if not exists (select 1 from expense_categories where society_id = p_society and code = p_category) then
    raise exception using errcode = 'P0001', message = 'Choose a valid expense category.';
  end if;
  perform public._check_amount(p_amount_paise);
  if p_day_of_month is null or p_day_of_month not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Day must be between 1 and 28.';
  end if;
  if p_id is null then
    insert into expense_templates (society_id, title, fund_id, category, payee, amount_paise, day_of_month, payment_mode, is_active, created_by)
    values (p_society, public.clean_text(p_title), p_fund_id, p_category, public.clean_text(p_payee), p_amount_paise,
            p_day_of_month, case when p_payment_mode is null then null else public._norm_mode(p_payment_mode) end,
            coalesce(p_is_active, true), auth.uid())
    returning id into v_id;
    insert into expense_template_versions (society_id, template_id, amount_paise, effective_period, reason, changed_by)
    values (p_society, v_id, p_amount_paise, public.period_of(public.ist_today()), 'Started', auth.uid());
    perform public._notify(p_society, public._all_member_ids(p_society), 'fixed_expense_change', v_id,
      format('New fixed monthly expense: %s', public.clean_text(p_title)),
      format('%s every month, around day %s.', public.fmt_inr(p_amount_paise), p_day_of_month), '/');
  else
    select * into old from expense_templates where id = p_id and society_id = p_society for update;
    if not found then raise exception using errcode = 'P0001', message = 'Template not found.'; end if;
    if p_amount_paise <> old.amount_paise then
      raise exception using errcode = 'P0001', message = 'Use "Change amount" to change the amount, so the history is kept.';
    end if;
    update expense_templates set title = public.clean_text(p_title), fund_id = p_fund_id, category = p_category,
           payee = public.clean_text(p_payee), day_of_month = p_day_of_month,
           payment_mode = case when p_payment_mode is null then null else public._norm_mode(p_payment_mode) end,
           is_active = coalesce(p_is_active, true)
     where id = p_id;
    v_id := p_id;
    if old.title is distinct from public.clean_text(p_title) or old.day_of_month <> p_day_of_month or old.is_active <> coalesce(p_is_active, true) then
      perform public._notify(p_society, public._all_member_ids(p_society), 'fixed_expense_change', v_id,
        format('Fixed monthly expense updated: %s', public.clean_text(p_title)),
        case when old.is_active and not coalesce(p_is_active, true) then 'This expense is paused.'
             when not old.is_active and coalesce(p_is_active, true) then 'This expense is active again.'
             else format('%s, around day %s of every month.', public.fmt_inr(old.amount_paise), p_day_of_month) end, '/');
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.change_template_amount(p_template uuid, p_amount_paise bigint, p_mode text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; v_reason text := public.clean_text(p_reason); v_cur text := public.period_of(public.ist_today());
        v_next text := public._next_period(); v_from text; v_effective bigint; d record;
begin
  select * into t from expense_templates where id = p_template for update;
  if not found then raise exception using errcode = 'P0001', message = 'Template not found.'; end if;
  perform public.assert_perm(t.society_id, 'record_expense');
  perform public._check_amount(p_amount_paise);
  if p_mode not in ('now', 'next') then raise exception using errcode = 'P0001', message = 'Choose when the new amount starts.'; end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a short reason — everyone will see it.';
  end if;
  v_effective := public._template_amount_for(t.id, case when p_mode = 'now' then v_cur else v_next end);
  if p_amount_paise = v_effective then
    raise exception using errcode = 'P0001', message = 'That is already the amount for this period.';
  end if;
  if p_mode = 'now' then
    select * into d from expense_drafts where template_id = t.id and period = v_cur for update;
    if found and d.status = 'confirmed' then
      raise exception using errcode = 'P0001',
        message = format('This month''s payment (%s) is already recorded. Choose "From next month", or reverse that expense first.', public.fmt_inr(d.amount_paise));
    end if;
    update expense_templates set amount_paise = p_amount_paise, pending_amount_paise = null, pending_from_period = null where id = t.id;
    update expense_drafts set amount_paise = p_amount_paise where template_id = t.id and period = v_cur and status = 'pending';
    v_from := v_cur;
  else
    update expense_templates set pending_amount_paise = p_amount_paise, pending_from_period = v_next where id = t.id;
    v_from := v_next;
  end if;
  insert into expense_template_versions (society_id, template_id, amount_paise, effective_period, reason, changed_by)
  values (t.society_id, t.id, p_amount_paise, v_from, v_reason, auth.uid());
  perform public._notify(t.society_id, public._all_member_ids(t.society_id), 'fixed_expense_change', t.id,
    format('%s: %s → %s', t.title, public.fmt_inr(t.amount_paise), public.fmt_inr(p_amount_paise)),
    format('From %s. %s', public._period_label(v_from), v_reason), '/');
  return jsonb_build_object('effective_period', v_from, 'amount_paise', p_amount_paise);
end $$;
grant execute on function public.change_template_amount(uuid, bigint, text, text) to authenticated;

create or replace function public._promote_pending_amounts(p_society uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cur text := public.period_of(public.ist_today());
begin
  update expense_templates set amount_paise = pending_amount_paise, pending_amount_paise = null, pending_from_period = null
   where society_id = p_society and pending_from_period is not null and pending_from_period <= v_cur;
  update event_series set total_cost_paise = pending_total_paise, pending_total_paise = null, pending_from_period = null
   where society_id = p_society and pending_from_period is not null and pending_from_period <= v_cur;
end $$;
revoke execute on function public._promote_pending_amounts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Recurring events
-- ---------------------------------------------------------------------------
create table if not exists public.event_series (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  description text check (description is null or char_length(description) <= 2000),
  scope_type text not null check (scope_type in ('all', 'unit_types')),
  scope_unit_type_ids uuid[] not null default '{}',
  total_cost_paise bigint not null check (total_cost_paise > 0 and total_cost_paise <= 1000000000),
  pending_total_paise bigint check (pending_total_paise is null or (pending_total_paise > 0 and pending_total_paise <= 1000000000)),
  pending_from_period text check (pending_from_period is null or public.is_valid_period(pending_from_period)),
  due_day int not null default 10 check (due_day between 1 and 28),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.event_series_versions (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  series_id uuid not null references public.event_series(id) on delete cascade,
  total_cost_paise bigint not null check (total_cost_paise > 0),
  effective_period text not null check (public.is_valid_period(effective_period)),
  reason text,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index if not exists esv_series_idx on public.event_series_versions(series_id, changed_at);

alter table public.events add column if not exists series_id uuid references public.event_series(id);
alter table public.events add column if not exists series_period text check (series_period is null or public.is_valid_period(series_period));
create unique index if not exists events_series_period_unique on public.events(series_id, series_period) where series_id is not null;

do $$
declare t text;
begin
  foreach t in array array['event_series', 'event_series_versions', 'expense_template_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated using (public.is_member(society_id))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
    execute format('create trigger zz_view_only_guard before insert or update or delete on public.%I for each statement execute function public.block_view_only_writes()', t);
  end loop;
end $$;

create or replace function public._series_total_for(p_series uuid, p_period text) returns bigint
language sql stable security definer set search_path = public as $$
  select case when pending_from_period is not null and p_period >= pending_from_period then pending_total_paise else total_cost_paise end
    from event_series where id = p_series
$$;
revoke execute on function public._series_total_for(uuid, text) from public, anon, authenticated;

-- Creates and opens the event of one month for a series (no-op if it already exists). Used by the daily job
-- and by the admin buttons; returns the event id (null when nothing was created).
create or replace function public._publish_series_month(p_series uuid, p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_scope uuid[]; v_rounding bigint; v_total bigint; v_share bigint; v_id uuid; v_due date;
begin
  select * into s from event_series where id = p_series for update;
  if not found then return null; end if;
  if exists (select 1 from events where series_id = s.id and series_period = p_period) then return null; end if;
  if s.scope_type = 'all' then
    select array_agg(id order by sort_order, code) into v_scope from units where society_id = s.society_id and is_billable;
  else
    select array_agg(id order by sort_order, code) into v_scope from units
     where society_id = s.society_id and is_billable and unit_type_id = any(s.scope_unit_type_ids);
  end if;
  if coalesce(array_length(v_scope, 1), 0) = 0 then return null; end if;
  select share_rounding_paise into v_rounding from society_settings where society_id = s.society_id;
  v_total := public._series_total_for(s.id, p_period);
  v_share := public.event_share_paise(v_total, array_length(v_scope, 1), v_rounding);
  v_due := greatest(make_date(substr(p_period, 1, 4)::int, substr(p_period, 6, 2)::int, s.due_day), public.ist_today());
  insert into events (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, rounding_paise,
                      in_scope_count, expected_count, per_unit_share_paise, due_date, created_by, series_id, series_period)
  values (s.society_id, s.title || ' – ' || public._period_label(p_period), s.description, s.scope_type, s.scope_unit_type_ids,
          v_total, v_rounding, array_length(v_scope, 1), array_length(v_scope, 1), v_share, v_due, s.created_by, s.id, p_period)
  returning id into v_id;
  insert into event_units (event_id, unit_id, society_id, expected) select v_id, x, s.society_id, true from unnest(v_scope) x;
  perform public._open_event(v_id);
  return v_id;
end $$;
revoke execute on function public._publish_series_month(uuid, text) from public, anon, authenticated;

create or replace function public._generate_series_events(p_society uuid) returns int
language plpgsql security definer set search_path = public as $$
declare s record; v_n int := 0; v_cur text := public.period_of(public.ist_today());
begin
  for s in select id from event_series where society_id = p_society and is_active loop
    if public._publish_series_month(s.id, v_cur) is not null then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public._generate_series_events(uuid) from public, anon, authenticated;

create or replace function public.create_event_series(
  p_society uuid, p_title text, p_description text, p_total_cost_paise bigint, p_scope_type text,
  p_unit_type_ids uuid[] default '{}', p_due_day int default 10, p_publish_now boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_title text := public.clean_text(p_title); v_id uuid; v_cur text := public.period_of(public.ist_today());
begin
  perform public.assert_perm(p_society, 'manage_events');
  if char_length(coalesce(v_title, '')) < 3 or char_length(v_title) > 80 then
    raise exception using errcode = 'P0001', message = 'Name must be 3 to 80 characters.';
  end if;
  perform public._check_amount(p_total_cost_paise);
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Due day must be between 1 and 28.';
  end if;
  if p_scope_type = 'unit_types' then
    if coalesce(array_length(p_unit_type_ids, 1), 0) = 0 then
      raise exception using errcode = 'P0001', message = 'Pick at least one flat type.';
    end if;
    if exists (select 1 from unnest(p_unit_type_ids) t where t not in (select id from unit_types where society_id = p_society)) then
      raise exception using errcode = 'P0001', message = 'Unknown flat type.';
    end if;
  elsif p_scope_type <> 'all' then
    raise exception using errcode = 'P0001', message = 'Choose who this applies to.';
  end if;
  insert into event_series (society_id, title, description, scope_type, scope_unit_type_ids, total_cost_paise, due_day, created_by)
  values (p_society, v_title, left(public.clean_body(p_description), 2000), p_scope_type,
          case when p_scope_type = 'unit_types' then p_unit_type_ids else '{}' end, p_total_cost_paise, p_due_day, auth.uid())
  returning id into v_id;
  insert into event_series_versions (society_id, series_id, total_cost_paise, effective_period, reason, changed_by)
  values (p_society, v_id, p_total_cost_paise, v_cur, 'Started', auth.uid());
  perform public._notify(p_society, public._all_member_ids(p_society), 'series_change', v_id,
    format('New monthly collection: %s', v_title),
    format('%s a month, shared by the flats. A new event is published on the 1st of every month.', public.fmt_inr(p_total_cost_paise)), '/events');
  if coalesce(p_publish_now, true) then perform public._publish_series_month(v_id, v_cur); end if;
  return v_id;
end $$;
grant execute on function public.create_event_series(uuid, text, text, bigint, text, uuid[], int, boolean) to authenticated;

create or replace function public.update_event_series(p_series uuid, p_title text, p_description text, p_due_day int, p_is_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s record; v_title text := public.clean_text(p_title);
begin
  select * into s from event_series where id = p_series for update;
  if not found then raise exception using errcode = 'P0001', message = 'Recurring event not found.'; end if;
  perform public.assert_perm(s.society_id, 'manage_events');
  if char_length(coalesce(v_title, '')) < 3 or char_length(v_title) > 80 then
    raise exception using errcode = 'P0001', message = 'Name must be 3 to 80 characters.';
  end if;
  if p_due_day is null or p_due_day not between 1 and 28 then
    raise exception using errcode = 'P0001', message = 'Due day must be between 1 and 28.';
  end if;
  update event_series set title = v_title, description = left(public.clean_body(p_description), 2000),
         due_day = p_due_day, is_active = coalesce(p_is_active, true) where id = s.id;
  if s.title is distinct from v_title or s.due_day <> p_due_day or s.is_active <> coalesce(p_is_active, true) then
    perform public._notify(s.society_id, public._all_member_ids(s.society_id), 'series_change', s.id,
      format('Recurring collection updated: %s', v_title),
      case when s.is_active and not coalesce(p_is_active, true) then 'It will no longer be published automatically each month.'
           when not s.is_active and coalesce(p_is_active, true) then 'It will be published automatically on the 1st of every month.'
           else format('Due by day %s of each month. Earlier months are not affected.', p_due_day) end, '/events');
  end if;
end $$;
grant execute on function public.update_event_series(uuid, text, text, int, boolean) to authenticated;

create or replace function public.change_series_amount(p_series uuid, p_total_cost_paise bigint, p_mode text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_reason text := public.clean_text(p_reason); v_cur text := public.period_of(public.ist_today());
        v_next text := public._next_period(); v_from text; ev record; v_excl jsonb;
begin
  select * into s from event_series where id = p_series for update;
  if not found then raise exception using errcode = 'P0001', message = 'Recurring event not found.'; end if;
  perform public.assert_perm(s.society_id, 'manage_events');
  perform public._check_amount(p_total_cost_paise);
  if p_mode not in ('now', 'next') then raise exception using errcode = 'P0001', message = 'Choose when the new amount starts.'; end if;
  if char_length(coalesce(v_reason, '')) < 3 then
    raise exception using errcode = 'P0001', message = 'Give a short reason — everyone will see it.';
  end if;
  if p_total_cost_paise = public._series_total_for(s.id, case when p_mode = 'now' then v_cur else v_next end) then
    raise exception using errcode = 'P0001', message = 'That is already the amount for this period.';
  end if;
  if p_mode = 'now' then
    select * into ev from events where series_id = s.id and series_period = v_cur for update;
    if found and ev.status <> 'closed' then
      select coalesce(jsonb_agg(jsonb_build_object('unit_id', unit_id, 'reason', exclusion_reason)), '[]'::jsonb) into v_excl
        from event_units where event_id = ev.id and not expected;
      perform public.update_event_target(ev.id, p_total_cost_paise, v_excl, v_reason);
    elsif found then
      raise exception using errcode = 'P0001', message = 'This month''s event is already closed. Choose "From next month".';
    end if;
    update event_series set total_cost_paise = p_total_cost_paise, pending_total_paise = null, pending_from_period = null where id = s.id;
    v_from := v_cur;
  else
    update event_series set pending_total_paise = p_total_cost_paise, pending_from_period = v_next where id = s.id;
    v_from := v_next;
  end if;
  insert into event_series_versions (society_id, series_id, total_cost_paise, effective_period, reason, changed_by)
  values (s.society_id, s.id, p_total_cost_paise, v_from, v_reason, auth.uid());
  perform public._notify(s.society_id, public._all_member_ids(s.society_id), 'series_change', s.id,
    format('%s: %s → %s a month', s.title, public.fmt_inr(s.total_cost_paise), public.fmt_inr(p_total_cost_paise)),
    format('From %s. Earlier months are not affected. %s', public._period_label(v_from), v_reason), '/events');
  return jsonb_build_object('effective_period', v_from, 'total_cost_paise', p_total_cost_paise);
end $$;
grant execute on function public.change_series_amount(uuid, bigint, text, text) to authenticated;

create or replace function public.publish_series_month(p_series uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s record; v_id uuid;
begin
  select * into s from event_series where id = p_series;
  if not found then raise exception using errcode = 'P0001', message = 'Recurring event not found.'; end if;
  perform public.assert_perm(s.society_id, 'manage_events');
  v_id := public._publish_series_month(s.id, public.period_of(public.ist_today()));
  if v_id is null then raise exception using errcode = 'P0001', message = 'This month''s event is already published.'; end if;
  return v_id;
end $$;
grant execute on function public.publish_series_month(uuid) to authenticated;

-- Everyone can read the recurring items and their history (display only)
create or replace function public.recurring_overview(p_society uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cur text := public.period_of(public.ist_today());
begin
  perform public.assert_member(p_society);
  return jsonb_build_object(
    'series', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'description', s.description, 'scope_type', s.scope_type, 'due_day', s.due_day,
        'is_active', s.is_active, 'total_cost_paise', s.total_cost_paise,
        'pending_total_paise', s.pending_total_paise, 'pending_from_period', s.pending_from_period,
        'this_month_event_id', (select e.id from events e where e.series_id = s.id and e.series_period = v_cur),
        'history', coalesce((select jsonb_agg(jsonb_build_object('amount_paise', v.total_cost_paise, 'from', v.effective_period,
                    'reason', v.reason, 'at', v.changed_at) order by v.changed_at desc)
                   from event_series_versions v where v.series_id = s.id), '[]'::jsonb)) order by s.created_at)
       from event_series s where s.society_id = p_society), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'day_of_month', t.day_of_month, 'is_active', t.is_active, 'amount_paise', t.amount_paise,
        'pending_amount_paise', t.pending_amount_paise, 'pending_from_period', t.pending_from_period,
        'history', coalesce((select jsonb_agg(jsonb_build_object('amount_paise', v.amount_paise, 'from', v.effective_period,
                    'reason', v.reason, 'at', v.changed_at) order by v.changed_at desc)
                   from expense_template_versions v where v.template_id = t.id), '[]'::jsonb)) order by t.day_of_month)
       from expense_templates t where t.society_id = p_society), '[]'::jsonb));
end $$;
grant execute on function public.recurring_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Events overview (Home: last 3; Events page: filter by month / year)
-- ---------------------------------------------------------------------------
create or replace function public.events_overview(p_society uuid, p_year int default null, p_month int default null, p_limit int default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_periods jsonb; v_admin boolean;
begin
  perform public.assert_member(p_society);
  v_admin := public.is_admin(p_society);
  if p_month is not null and (p_month < 1 or p_month > 12) then
    raise exception using errcode = 'P0001', message = 'Invalid month.';
  end if;
  with ev as (
    select e.*, coalesce(e.series_period, public.period_of((e.created_at at time zone 'Asia/Kolkata')::date)) as period,
           (select coalesce(sum(case when l.direction = 'credit' then l.amount_paise else -l.amount_paise end), 0)
              from ledger_entries l where l.fund_id = e.fund_id and l.category = 'event_contribution') as collected
      from events e
     where e.society_id = p_society and (v_admin or e.status <> 'draft')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'status', status, 'period', period, 'due_date', due_date,
           'target_paise', total_cost_paise, 'collected_paise', collected, 'diff_paise', collected - total_cost_paise,
           'per_unit_share_paise', per_unit_share_paise, 'expected_count', expected_count, 'series_id', series_id)
         order by period desc, created_at desc), '[]'::jsonb)
    into v_rows
    from (select * from ev
           where (p_year is null or substr(period, 1, 4)::int = p_year)
             and (p_month is null or substr(period, 6, 2)::int = p_month)
           order by period desc, created_at desc
           limit least(coalesce(p_limit, 200), 200)) x;
  select coalesce(jsonb_agg(p order by p desc), '[]'::jsonb) into v_periods from (
    select distinct coalesce(e.series_period, public.period_of((e.created_at at time zone 'Asia/Kolkata')::date)) as p
      from events e where e.society_id = p_society and (v_admin or e.status <> 'draft')) q;
  return jsonb_build_object('events', v_rows, 'periods', v_periods);
end $$;
grant execute on function public.events_overview(uuid, int, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Daily job: also publish recurring events and promote scheduled amounts
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s record; v_out jsonb := '[]'; v_dues int; v_drafts int; v_rem int; v_purged int; v_series int;
        v_period text := public.period_of(public.ist_today());
begin
  for s in select so.id, st.start_month, st.location_retention_days from societies so join society_settings st on st.society_id = so.id loop
    v_dues := 0; v_drafts := 0; v_rem := 0; v_purged := 0; v_series := 0;
    begin
      perform public._promote_pending_amounts(s.id);
      if v_period >= s.start_month and not public.is_month_closed(s.id, v_period) then
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
