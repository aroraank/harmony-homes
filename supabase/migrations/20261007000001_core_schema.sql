-- Harmony Homes — core schema
-- All money is integer paise (bigint). All timestamps are timestamptz (UTC).
-- A "period" is a calendar month in Asia/Kolkata, keyed 'YYYY-MM'.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Small pure helpers
-- ---------------------------------------------------------------------------
create or replace function public.ist_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function public.period_of(d date) returns text
language sql immutable set search_path = public as $$
  select to_char(d, 'YYYY-MM')
$$;

create or replace function public.is_valid_period(p text) returns boolean
language sql immutable set search_path = public as $$
  select p is not null and p ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
$$;

create or replace function public.period_start(p text) returns date
language sql immutable set search_path = public as $$
  select to_date(p || '-01', 'YYYY-MM-DD')
$$;

create or replace function public.period_end(p text) returns date
language sql immutable set search_path = public as $$
  select (to_date(p || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
$$;

-- Collapse whitespace, trim, empty -> null
create or replace function public.clean_text(t text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')), '')
$$;

-- Trim but keep line breaks (multi-line bodies); strip all HTML tags; empty -> null
create or replace function public.clean_body(t text) returns text
language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(coalesce(t, ''), '<[^>]*>', '', 'g'), '[ \t]+\n', E'\n', 'g')), '')
$$;

-- ---------------------------------------------------------------------------
-- Societies and settings
-- ---------------------------------------------------------------------------
create table public.societies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  address text check (address is null or char_length(address) <= 300),
  created_at timestamptz not null default now()
);

create table public.society_settings (
  society_id uuid primary key references public.societies(id) on delete cascade,
  monthly_due_paise bigint not null default 80000 check (monthly_due_paise > 0 and monthly_due_paise <= 1000000000),
  due_day int not null default 7 check (due_day between 1 and 28),
  start_month text not null check (public.is_valid_period(start_month)),
  share_rounding_paise bigint not null default 1000 check (share_rounding_paise between 100 and 1000000),
  late_flag boolean not null default true,
  receipt_prefix text not null default 'HH' check (receipt_prefix ~ '^[A-Z]{1,6}$'),
  upi_id text check (upi_id is null or upi_id ~ '^[a-zA-Z0-9.\-_]{2,255}@[a-zA-Z]{2,64}$'),
  upi_payee_name text check (upi_payee_name is null or char_length(upi_payee_name) between 2 and 80),
  bank_account_name text check (bank_account_name is null or char_length(bank_account_name) <= 120),
  upi_qr_path text,
  transparency_feed boolean not null default true,
  location_retention_days int not null default 180 check (location_retention_days between 1 and 3650),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Property hierarchy
-- ---------------------------------------------------------------------------
create table public.unit_types (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  monthly_due_paise bigint check (monthly_due_paise is null or (monthly_due_paise > 0 and monthly_due_paise <= 1000000000)),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (society_id, name)
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  sort_order int not null default 0,
  unique (society_id, name)
);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  level int not null default 0,
  unique nulls not distinct (society_id, block_id, name)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  block_id uuid references public.blocks(id) on delete set null,
  floor_id uuid references public.floors(id) on delete set null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  unit_type_id uuid not null references public.unit_types(id),
  status text not null default 'occupied' check (status in ('occupied', 'vacant')),
  is_billable boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (society_id, code)
);
create index units_society_idx on public.units(society_id, sort_order);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 60),
  phone text unique check (phone is null or phone ~ '^[6-9][0-9]{9}$'),
  avatar_path text,
  must_change_password boolean not null default false,
  locale text not null default 'en' check (locale in ('en', 'hi')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid references public.units(id),
  role text not null check (role in ('super_admin', 'admin', 'resident')),
  status text not null default 'active' check (status in ('pending', 'active', 'deactivated')),
  created_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  deactivated_at timestamptz,
  deactivated_reason text,
  check (role <> 'resident' or unit_id is not null)
);
-- One active login per unit
create unique index memberships_one_active_per_unit on public.memberships(unit_id) where status = 'active' and unit_id is not null;
-- One live membership per user per society
create unique index memberships_one_live_per_user on public.memberships(user_id, society_id) where status <> 'deactivated';
create index memberships_society_idx on public.memberships(society_id, status);

create table public.role_permissions (
  society_id uuid not null references public.societies(id) on delete cascade,
  role text not null check (role in ('admin', 'resident')),
  permission text not null,
  allowed boolean not null,
  primary key (society_id, role, permission)
);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
create table public.funds (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('general', 'event')),
  event_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index funds_one_general on public.funds(society_id) where kind = 'general';

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null check (char_length(label) between 1 and 40),
  is_system boolean not null default false,
  sort_order int not null default 0,
  unique (society_id, code)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  description text check (description is null or char_length(description) <= 2000),
  scope_type text not null check (scope_type in ('all', 'unit_types', 'custom')),
  scope_unit_type_ids uuid[] not null default '{}',
  total_cost_paise bigint not null check (total_cost_paise > 0 and total_cost_paise <= 1000000000),
  rounding_paise bigint not null check (rounding_paise between 100 and 1000000),
  in_scope_count int not null check (in_scope_count >= 1),
  expected_count int not null check (expected_count >= 1),
  per_unit_share_paise bigint not null check (per_unit_share_paise > 0),
  fund_id uuid references public.funds(id),
  due_date date not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id),
  close_note text
);
alter table public.funds add constraint funds_event_fk foreign key (event_id) references public.events(id);

create table public.event_units (
  event_id uuid not null references public.events(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  society_id uuid not null references public.societies(id) on delete cascade,
  expected boolean not null,
  exclusion_reason text,
  primary key (event_id, unit_id),
  check (expected or char_length(coalesce(exclusion_reason, '')) >= 2)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id),
  fund_id uuid not null references public.funds(id),
  entry_date date not null,
  direction text not null check (direction in ('credit', 'debit')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  category text not null check (category ~ '^[a-z][a-z0-9_]{1,30}$'),
  unit_id uuid references public.units(id),
  payee text check (payee is null or char_length(payee) <= 120),
  payment_mode text check (payment_mode is null or payment_mode in ('upi', 'gpay', 'phonepe', 'paytm', 'cash', 'bank', 'cheque', 'other')),
  reference_no text check (reference_no is null or reference_no ~ '^[A-Z0-9]{6,30}$'),
  note text check (note is null or char_length(note) <= 500),
  attachment_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  reverses_entry_id uuid unique references public.ledger_entries(id),
  transfer_group uuid,
  receipt_no text,
  receipt_token text unique,
  claim_id uuid,
  idempotency_key text,
  backdate_reason text,
  unique (society_id, idempotency_key),
  unique (society_id, receipt_no)
);
create index ledger_society_date_idx on public.ledger_entries(society_id, entry_date desc, created_at desc);
create index ledger_unit_idx on public.ledger_entries(unit_id) where unit_id is not null;
create index ledger_fund_idx on public.ledger_entries(fund_id);
create index ledger_ref_idx on public.ledger_entries(society_id, reference_no) where reference_no is not null;

create table public.dues (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  fund_id uuid not null references public.funds(id),
  due_type text not null check (due_type in ('monthly', 'event')),
  period text check (period is null or public.is_valid_period(period)),
  event_id uuid references public.events(id),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  due_date date not null,
  waived boolean not null default false,
  waived_reason text,
  waived_by uuid references public.profiles(id),
  waived_at timestamptz,
  created_at timestamptz not null default now(),
  check ((due_type = 'monthly' and period is not null and event_id is null) or (due_type = 'event' and event_id is not null)),
  check (not waived or char_length(coalesce(waived_reason, '')) >= 3)
);
create unique index dues_monthly_unique on public.dues(unit_id, period) where due_type = 'monthly';
create unique index dues_event_unique on public.dues(unit_id, event_id) where due_type = 'event';
create index dues_society_period_idx on public.dues(society_id, period);
create index dues_unit_fund_idx on public.dues(unit_id, fund_id, due_date);

create table public.due_allocations (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id),
  ledger_entry_id uuid not null references public.ledger_entries(id),
  due_id uuid not null references public.dues(id),
  amount_paise bigint not null check (amount_paise > 0),
  created_at timestamptz not null default now()
);
create index due_alloc_due_idx on public.due_allocations(due_id);
create index due_alloc_entry_idx on public.due_allocations(ledger_entry_id);

create table public.month_closings (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  period text not null check (public.is_valid_period(period)),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz not null default now(),
  snapshot jsonb not null,
  reopened_by uuid references public.profiles(id),
  reopened_at timestamptz,
  reopen_reason text
);
create unique index month_closings_active on public.month_closings(society_id, period) where reopened_at is null;

create table public.receipt_counters (
  society_id uuid not null references public.societies(id) on delete cascade,
  fy text not null,
  last_no int not null default 0,
  primary key (society_id, fy)
);

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  fund_id uuid not null references public.funds(id),
  submitted_by uuid not null references public.profiles(id),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  paid_on date not null,
  payment_mode text not null check (payment_mode in ('upi', 'gpay', 'phonepe', 'paytm', 'cash', 'bank', 'cheque', 'other')),
  reference_no text check (reference_no is null or reference_no ~ '^[A-Z0-9]{6,30}$'),
  screenshot_path text,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reject_reason text,
  ledger_entry_id uuid references public.ledger_entries(id),
  created_at timestamptz not null default now()
);
create index payment_claims_society_idx on public.payment_claims(society_id, status, created_at desc);

create table public.expense_templates (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  fund_id uuid not null references public.funds(id),
  category text not null,
  payee text check (payee is null or char_length(payee) <= 120),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 1000000000),
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  payment_mode text check (payment_mode is null or payment_mode in ('upi', 'gpay', 'phonepe', 'paytm', 'cash', 'bank', 'cheque', 'other')),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.expense_drafts (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  template_id uuid not null references public.expense_templates(id) on delete cascade,
  period text not null check (public.is_valid_period(period)),
  amount_paise bigint not null check (amount_paise > 0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'skipped')),
  ledger_entry_id uuid references public.ledger_entries(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (template_id, period)
);

-- ---------------------------------------------------------------------------
-- Notices, notifications, push
-- ---------------------------------------------------------------------------
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  priority text not null default 'normal' check (priority in ('normal', 'important')),
  attachment_path text,
  audience_type text not null default 'all' check (audience_type in ('all', 'unit_types', 'units')),
  audience_unit_type_ids uuid[] not null default '{}',
  audience_unit_ids uuid[] not null default '{}',
  require_ack boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  last_reminded_at timestamptz
);
create index notices_society_idx on public.notices(society_id, created_at desc);

create table public.notice_receipts (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references public.notices(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_id uuid references public.units(id),
  delivered_at timestamptz,
  opened_at timestamptz,
  acknowledged_at timestamptz,
  ack_ip text,
  ack_user_agent text,
  ack_lat double precision,
  ack_lng double precision,
  ack_accuracy double precision,
  unique (notice_id, user_id)
);
create index notice_receipts_user_idx on public.notice_receipts(user_id, acknowledged_at);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  device_label text check (device_label is null or char_length(device_label) <= 120),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  society_id uuid references public.societies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  ref_id uuid,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending', 'sending', 'sent', 'failed', 'none')),
  push_attempts int not null default 0,
  pushed_at timestamptz
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_push_idx on public.notifications(push_status, created_at) where push_status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- Audit and alerts
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  society_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  row_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default clock_timestamp(),
  prev_hash text,
  row_hash text not null
);
create index audit_log_society_idx on public.audit_log(society_id, id desc);
create index audit_log_actor_idx on public.audit_log(actor_id, id desc);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  kind text not null,
  title text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);
create index alerts_society_idx on public.alerts(society_id, created_at desc);

create table public.login_failures (
  society_slug text not null,
  username text not null,
  window_start timestamptz not null default now(),
  failures int not null default 0,
  alerted boolean not null default false,
  primary key (society_slug, username)
);

-- ---------------------------------------------------------------------------
-- Concerns (private helpdesk)
-- ---------------------------------------------------------------------------
create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid references public.units(id),
  raised_by uuid not null references public.profiles(id),
  title text not null check (char_length(title) between 3 and 120),
  category text not null check (category in ('security', 'cleanliness', 'water', 'electricity', 'payments', 'neighbour', 'suggestion', 'other')),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to uuid references public.profiles(id),
  hide_name boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  last_message_at timestamptz not null default now()
);
create index concerns_society_idx on public.concerns(society_id, status, last_message_at desc);

create table public.concern_messages (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 4000),
  attachment_path text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  hidden_by uuid references public.profiles(id),
  hidden_reason text,
  hidden_at timestamptz
);
create index concern_messages_concern_idx on public.concern_messages(concern_id, created_at);

create table public.concern_reads (
  concern_id uuid not null references public.concerns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (concern_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Contacts directory
-- ---------------------------------------------------------------------------
create table public.contact_categories (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 40),
  sort_order int not null default 0,
  is_pinned boolean not null default false,
  unique (society_id, name)
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  category_id uuid not null references public.contact_categories(id),
  name text not null check (char_length(name) between 2 and 60),
  phone text not null check (phone ~ '^[6-9][0-9]{9}$'),
  alt_phone text check (alt_phone is null or alt_phone ~ '^[6-9][0-9]{9}$'),
  whatsapp boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 300),
  timings text check (timings is null or char_length(timings) <= 80),
  typical_rate text check (typical_rate is null or char_length(typical_rate) <= 80),
  status text not null default 'active' check (status in ('active', 'suggested', 'rejected', 'archived')),
  added_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Maintenance reminders
-- ---------------------------------------------------------------------------
create table public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  message text not null check (char_length(message) between 1 and 500),
  interval_unit text not null check (interval_unit in ('days', 'months')),
  interval_count int not null check (interval_count between 1 and 365),
  next_date date not null,
  audience_type text not null default 'all' check (audience_type in ('all', 'unit_types', 'units')),
  audience_unit_type_ids uuid[] not null default '{}',
  audience_unit_ids uuid[] not null default '{}',
  contact_category_id uuid references public.contact_categories(id),
  kind text not null check (kind in ('advisory', 'task')),
  is_paused boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.reminder_occurrences (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.reminder_schedules(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  due_date date not null,
  sent_at timestamptz not null default now(),
  unique (schedule_id, due_date)
);

create table public.reminder_responses (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.reminder_occurrences(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('done', 'snooze')),
  snooze_until date,
  snooze_notified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (occurrence_id, unit_id)
);

create table public.reminder_task_logs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.reminder_schedules(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  done_on date not null,
  cost_paise bigint check (cost_paise is null or (cost_paise > 0 and cost_paise <= 1000000000)),
  ledger_entry_id uuid references public.ledger_entries(id),
  note text check (note is null or char_length(note) <= 500),
  done_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
