import { getLocal, setLocal } from './storage';

/**
 * Super admin "View as". While active, the browser holds a read-only session for another
 * member; the super admin's own session is parked here so they can switch back.
 * The database independently refuses every write from such a session.
 */
export type ViewAsState = {
  access_token: string;
  refresh_token: string;
  viewer_name: string;
  label: string;
  role: string;
  started_at: string;
};

const KEY = 'hh-view-as';

export function getViewAs(): ViewAsState | null {
  try {
    const raw = getLocal(KEY);
    return raw ? (JSON.parse(raw) as ViewAsState) : null;
  } catch {
    return null;
  }
}

export function setViewAs(v: ViewAsState | null) {
  setLocal(KEY, v ? JSON.stringify(v) : null);
}

export function isViewingAs(): boolean {
  return getViewAs() !== null;
}

/** RPCs that only read. Everything else is refused in the app while viewing as someone. */
export const READ_ONLY_RPCS = new Set([
  'check_duplicate_reference',
  'dashboard',
  'defaulters',
  'event_report',
  'society_position',
  'ledger_statement',
  'unit_ledger_statement',
  'surplus_board',
  'society_owed_total',
  'general_fund_id',
  'month_report',
  'my_context',
  'my_pay_info',
  'my_reminder_cards',
  'my_sessions',
  'payee_history',
  'payee_list',
  'preview_allocation',
  'reminder_done_count',
  'registration_options',
  'society_public',
  'trend_months',
  'unit_statement',
  'verify_audit_chain',
  'verify_receipt',
]);

/** Background bookkeeping writes that are quietly skipped (no error toast) while viewing. */
export const SILENT_SKIP_RPCS = new Set([
  'log_statement_export',
  'mark_notices_delivered',
  'mark_notice_opened',
  'mark_notifications_read',
  'mark_concern_read',
  'save_push_subscription',
  'delete_push_subscription',
  'set_my_locale',
  'report_failed_login',
]);
