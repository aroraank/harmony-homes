// Shapes returned by the database RPCs / views. Amounts are integer paise.

export type Role = 'super_admin' | 'admin' | 'resident';
export type Permission =
  | 'record_payment'
  | 'record_expense'
  | 'approve_claims'
  | 'reverse_entry'
  | 'manage_events'
  | 'generate_dues'
  | 'close_month'
  | 'reopen_month'
  | 'send_notices'
  | 'manage_units'
  | 'manage_users'
  | 'manage_settings'
  | 'view_audit_all'
  | 'manage_contacts'
  | 'manage_reminders'
  | 'manage_concerns'
  | 'record_adjustment'
  | 'manage_meetings';

export interface Membership {
  membership_id: string;
  society_id: string;
  society_name: string;
  society_slug: string;
  role: Role;
  status: 'pending' | 'active' | 'deactivated';
  unit_id: string | null;
  unit_code: string | null;
  unit_name: string | null;
  unit_type_id: string | null;
  permissions: Permission[];
}

export interface Profile {
  id: string;
  full_name: string;
  phone: string | null;
  must_change_password: boolean;
  locale: 'en' | 'hi';
}

export interface MyContext {
  user_id: string;
  profile: Profile | null;
  memberships: Membership[];
}

export type UnitStatus = 'paid' | 'partial' | 'pending' | 'advance' | 'waived' | 'none' | 'excluded' | 'draft';

export interface PeriodStatus {
  status: UnitStatus;
  due_id?: string;
  due_paise: number;
  paid_paise: number;
  pending_paise: number;
  advance_paise: number;
  due_date?: string;
  overdue?: boolean;
}

export interface Dashboard {
  period: string;
  role: Role;
  balance_paise: number;
  funds: { id: string; name: string; kind: 'general' | 'event'; event_id: string | null; balance_paise: number }[];
  month: { expected_paise: number; collected_paise: number; spent_paise: number; status_counts: Partial<Record<UnitStatus, number>> };
  events: { id: string; title: string; target_paise: number; per_unit_share_paise: number; due_date: string; collected_paise: number }[];
  fixed_expenses: { title: string; amount_paise: number; day_of_month: number }[];
  unacked_notices: number;
  unread_notifications: number;
  admin: null | {
    pending_claims: number;
    pending_drafts: number;
    open_concerns: number;
    open_alerts: number;
    pending_registrations: number;
    suggested_contacts: number;
    dues_generated: boolean;
  };
  mine: null | {
    unit_id: string;
    unit_code: string;
    pending_paise: number;
    maintenance_pending_paise: number;
    advance_paise: number;
    this_month: PeriodStatus;
    pending_claims: number;
  };
}

export interface LedgerRow {
  id: string;
  society_id: string;
  fund_id: string;
  fund_name: string;
  fund_kind: 'general' | 'event';
  entry_date: string;
  direction: 'credit' | 'debit';
  amount_paise: number;
  category: string;
  unit_id: string | null;
  unit_code: string | null;
  payee: string | null;
  payment_mode: string | null;
  reference_no: string | null;
  note: string | null;
  attachment_path: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  reverses_entry_id: string | null;
  transfer_group: string | null;
  receipt_no: string | null;
  receipt_token: string | null;
  claim_id: string | null;
  backdate_reason: string | null;
  is_reversed: boolean;
  reversal_note: string | null;
  signed_paise: number;
}

export interface DueRow {
  id: string;
  society_id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  fund_id: string;
  due_type: 'monthly' | 'event';
  period: string | null;
  event_id: string | null;
  event_title: string | null;
  amount_paise: number;
  due_date: string;
  waived: boolean;
  waived_reason: string | null;
  label: string;
  paid_paise: number;
  pending_paise: number;
}

export interface MonthReport {
  period: string;
  label: string;
  fund_id: string | null;
  is_closed: boolean;
  opening_paise: number;
  closing_paise: number;
  maintenance_collected_paise: number;
  event_collected_paise: number;
  other_income_paise: number;
  transfers_net_paise: number;
  spent_paise: number;
  net_paise: number;
  shortfall_paise: number;
  surplus_paise: number;
  expected_paise: number;
  collected_for_dues_paise: number;
  collected_from_advances_paise: number;
  pending_paise: number;
  spent_by_category: { category: string; label: string; amount_paise: number }[];
  expenses: { entry_id: string; date: string; payee: string | null; category: string; amount_paise: number; mode: string; fund: string }[];
  payments: {
    entry_id: string;
    unit_id: string;
    unit_code: string;
    amount_paise: number;
    date: string;
    mode: string;
    receipt_no: string;
    fund: string;
    category: string;
  }[];
  units: ({ unit_id: string; unit_code: string; unit_name: string } & PeriodStatus)[];
  extra_payers: { unit_id: string; unit_code: string; extra_paise: number }[];
}

export interface UnitStatement {
  unit: { id: string; code: string; display_name: string; type: string; status: string };
  dues: {
    id: string;
    label: string;
    due_type: string;
    period: string | null;
    event_id: string | null;
    due_date: string;
    amount_paise: number;
    paid_paise: number;
    pending_paise: number;
    waived: boolean;
    waived_reason: string | null;
  }[];
  payments: {
    entry_id: string;
    date: string;
    amount_paise: number;
    fund: string;
    fund_kind: string;
    mode: string;
    reference_no: string | null;
    receipt_no: string | null;
    is_reversed: boolean;
    note: string | null;
    allocations: { label: string; amount_paise: number }[];
  }[];
  totals: { pending_paise: number; overdue_paise: number; paid_paise: number; advance_paise: number; event_advance_paise: number };
}

export interface Defaulter {
  unit_id: string;
  unit_code: string;
  unit_name: string;
  pending_paise: number;
  months_overdue: number;
  events_overdue: number;
  oldest_due_date: string;
  periods: string[];
}

export interface EventRow {
  id: string;
  society_id: string;
  title: string;
  description: string | null;
  scope_type: 'all' | 'unit_types' | 'custom';
  scope_unit_type_ids: string[];
  total_cost_paise: number;
  rounding_paise: number;
  in_scope_count: number;
  expected_count: number;
  per_unit_share_paise: number;
  fund_id: string | null;
  due_date: string;
  status: 'draft' | 'open' | 'closed';
  created_at: string;
  closed_at: string | null;
  close_note: string | null;
}

export interface EventReport {
  event: EventRow & { scope_unit_type_names: string[] };
  target_paise: number;
  expected_collection_paise: number;
  rounding_buffer_paise: number;
  collected_paise: number;
  spent_paise: number;
  transfers_paise: number;
  balance_paise: number;
  remaining_to_collect_paise: number;
  surplus_paise: number;
  shortfall_paise: number;
  units: {
    unit_id: string;
    unit_code: string;
    unit_name: string;
    expected: boolean;
    exclusion_reason: string | null;
    due_id: string | null;
    due_paise: number;
    paid_paise: number;
    waived: boolean;
    extra_paise: number;
    status: UnitStatus;
  }[];
  entries: {
    entry_id: string;
    date: string;
    direction: 'credit' | 'debit';
    amount_paise: number;
    category: string;
    unit_code: string | null;
    payee: string | null;
    note: string | null;
    is_reversed: boolean;
    is_reversal: boolean;
  }[];
}

export interface Unit {
  id: string;
  society_id: string;
  code: string;
  display_name: string;
  unit_type_id: string;
  status: 'occupied' | 'vacant';
  is_billable: boolean;
  sort_order: number;
  block_id: string | null;
  floor_id: string | null;
}

export interface UnitType {
  id: string;
  name: string;
  monthly_due_paise: number | null;
  sort_order: number;
}

export interface Fund {
  id: string;
  name: string;
  kind: 'general' | 'event';
  event_id: string | null;
  is_active: boolean;
}

export interface ExpenseCategory {
  id: string;
  code: string;
  label: string;
  is_system: boolean;
  sort_order: number;
}

export interface Settings {
  society_id: string;
  monthly_due_paise: number;
  due_day: number;
  start_month: string;
  share_rounding_paise: number;
  late_flag: boolean;
  receipt_prefix: string;
  upi_id: string | null;
  upi_payee_name: string | null;
  bank_account_name: string | null;
  upi_qr_path: string | null;
  transparency_feed: boolean;
  location_retention_days: number;
}

export interface PayInfo {
  unit_id: string | null;
  unit_code: string | null;
  upi_id: string | null;
  upi_payee_name: string | null;
  bank_account_name: string | null;
  upi_qr_path: string | null;
  monthly_due_paise: number;
  purposes: { fund_id: string; kind: 'general' | 'event'; label: string; pending_paise: number; oldest_period?: string | null; event_id?: string }[];
}

export interface Claim {
  id: string;
  unit_id: string;
  fund_id: string;
  submitted_by: string;
  amount_paise: number;
  paid_on: string;
  payment_mode: string;
  reference_no: string | null;
  screenshot_path: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_at: string | null;
  reject_reason: string | null;
  ledger_entry_id: string | null;
  created_at: string;
}

export interface Notice {
  id: string;
  society_id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important';
  attachment_path: string | null;
  audience_type: 'all' | 'unit_types' | 'units';
  audience_unit_type_ids: string[];
  audience_unit_ids: string[];
  require_ack: boolean;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
  last_reminded_at: string | null;
}

export interface NoticeReceipt {
  id: string;
  notice_id: string;
  user_id: string;
  unit_id: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  acknowledged_at: string | null;
  ack_ip: string | null;
  ack_user_agent: string | null;
  ack_lat: number | null;
  ack_lng: number | null;
  ack_accuracy: number | null;
}

export interface Concern {
  id: string;
  society_id: string;
  unit_id: string | null;
  unit_code: string | null;
  raised_by: string | null;
  raiser_name: string | null;
  is_mine: boolean;
  title: string;
  category: string;
  priority: 'normal' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  assigned_to: string | null;
  assignee_name: string | null;
  hide_name: boolean;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  last_message_at: string;
  unread: boolean;
  message_count: number;
}

export interface ConcernMessage {
  id: string;
  concern_id: string;
  author_id: string | null;
  author_name: string;
  is_mine: boolean;
  author_role: Role;
  body: string | null;
  attachment_path: string | null;
  is_system: boolean;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
}

export interface Contact {
  id: string;
  category_id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  whatsapp: boolean;
  notes: string | null;
  timings: string | null;
  typical_rate: string | null;
  status: 'active' | 'suggested' | 'rejected' | 'archived';
  added_by: string | null;
}

export interface ContactCategory {
  id: string;
  name: string;
  sort_order: number;
  is_pinned: boolean;
}

export interface ReminderSchedule {
  id: string;
  title: string;
  message: string;
  interval_unit: 'days' | 'months';
  interval_count: number;
  next_date: string;
  audience_type: 'all' | 'unit_types' | 'units';
  audience_unit_type_ids: string[];
  audience_unit_ids: string[];
  contact_category_id: string | null;
  kind: 'advisory' | 'task';
  is_paused: boolean;
  deleted_at: string | null;
}

export interface ReminderCard {
  occurrence_id: string;
  schedule_id: string;
  kind: 'advisory' | 'task';
  title: string;
  message: string;
  due_date: string;
  contact_category_id: string | null;
}

export interface AppNotification {
  id: string;
  kind: string;
  ref_id: string | null;
  title: string;
  body: string | null;
  url: string | null;
  created_at: string;
  read_at: string | null;
}

export interface AuditRow {
  id: number;
  society_id: string | null;
  actor_id: string | null;
  action: string;
  table_name: string;
  row_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface MemberRow {
  id: string;
  user_id: string;
  society_id: string;
  unit_id: string | null;
  role: Role;
  status: 'pending' | 'active' | 'deactivated';
  created_at: string;
  deactivated_reason: string | null;
  profiles: { full_name: string; phone: string | null; must_change_password: boolean } | null;
}

export interface AlertRow {
  id: string;
  kind: string;
  title: string;
  details: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
}

export interface Meeting {
  id: string;
  society_id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'published' | 'cancelled';
  scope_type: 'all' | 'unit_types' | 'custom';
  scope_unit_type_ids: string[];
  scope_unit_ids: string[];
  meeting_date: string;
  start_time: string;
  location: string | null;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  audience_label: string;
  agenda: { id: string; text: string }[];
  created_by_name: string | null;
}
