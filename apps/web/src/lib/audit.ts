import { formatINR, periodLabel } from '@harmony/shared';
import type { AuditRow } from '@/types';
import { categoryLabel } from './utils';

const TABLE_LABELS: Record<string, string> = {
  ledger_entries: 'ledger entry',
  due_allocations: 'payment allocation',
  dues: 'due',
  memberships: 'membership',
  profiles: 'profile',
  society_settings: 'settings',
  societies: 'society',
  units: 'unit',
  unit_types: 'flat type',
  events: 'event',
  event_units: 'event payer',
  funds: 'fund',
  notices: 'notice',
  notice_receipts: 'notice receipt',
  payment_claims: 'payment claim',
  month_closings: 'month closing',
  concerns: 'concern',
  concern_messages: 'concern message',
  contacts: 'contact',
  contact_categories: 'contact category',
  reminder_schedules: 'reminder',
  reminder_task_logs: 'task log',
  expense_templates: 'recurring expense',
  expense_drafts: 'expense draft',
  alerts: 'alert',
  role_permissions: 'admin permission',
  auth: 'login',
};

type J = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** Plain-language one-liner, e.g. "reversed ₹1,500 payment for P3-FF — reason: typo" */
export function describeAudit(r: AuditRow, units: Record<string, string>): string {
  const a = (r.after ?? {}) as J;
  const b = (r.before ?? {}) as J;
  const amt = (x: J) => formatINR(Number(x.amount_paise ?? 0));
  const unit = (x: J) => units[s(x.unit_id)] ?? '';
  switch (r.table_name) {
    case 'ledger_entries':
      if (a.reverses_entry_id) return `reversed ${amt(a)} ${a.unit_id ? `payment for ${unit(a)}` : categoryLabel(s(a.category)).toLowerCase()} — ${s(a.note).replace(/^Reversal:\s*/, 'reason: ')}`;
      if (a.category === 'transfer') return `moved ${amt(a)} ${a.direction === 'credit' ? 'into' : 'out of'} a fund — ${s(a.note)}`;
      if (a.direction === 'credit' && a.unit_id) return `recorded ${amt(a)} payment for ${unit(a)}${a.receipt_no ? ` (receipt ${s(a.receipt_no)})` : ''}`;
      if (a.direction === 'credit') return `recorded ${amt(a)} ${categoryLabel(s(a.category)).toLowerCase()}`;
      return `recorded ${amt(a)} expense — ${categoryLabel(s(a.category))}${a.payee ? ` to ${s(a.payee)}` : ''}`;
    case 'month_closings':
      if (r.action === 'insert') return `closed ${periodLabel(s(a.period))}`;
      if (a.reopened_at && !b.reopened_at) return `reopened ${periodLabel(s(a.period))} — reason: ${s(a.reopen_reason)}`;
      break;
    case 'memberships':
      if (r.action === 'update' && a.role !== b.role) return `changed role ${s(b.role)} → ${s(a.role)}${a.unit_id ? ` for ${unit(a)}` : ''}`;
      if (r.action === 'update' && a.status !== b.status) return `${s(a.status) === 'active' ? 'approved' : s(a.status)} membership${a.unit_id ? ` of ${unit(a)}` : ''}${a.deactivated_reason ? ` — ${s(a.deactivated_reason)}` : ''}`;
      if (r.action === 'insert') return `added ${s(a.role)}${a.unit_id ? ` login for ${unit(a)}` : ''} (${s(a.status)})`;
      break;
    case 'society_settings':
      return `changed settings: ${changedKeys(b, a).join(', ')}`;
    case 'dues':
      if (r.action === 'update' && a.waived && !b.waived) return `waived ${amt(a)} due of ${unit(a)} — ${s(a.waived_reason)}`;
      if (r.action === 'insert') return `created ${amt(a)} due for ${unit(a)}${a.period ? ` (${periodLabel(s(a.period))})` : ''}`;
      break;
    case 'payment_claims':
      if (r.action === 'insert') return `submitted payment claim of ${amt(a)} for ${unit(a)}`;
      if (a.status !== b.status) return `${s(a.status)} payment claim of ${amt(a)} for ${unit(a)}${a.reject_reason ? ` — ${s(a.reject_reason)}` : ''}`;
      break;
    case 'notices':
      if (r.action === 'insert') return `sent notice “${s(a.title)}”`;
      if (a.archived_at && !b.archived_at) return `archived notice “${s(a.title)}”`;
      break;
    case 'events':
      if (r.action === 'insert') return `created event “${s(a.title)}” (${amt({ amount_paise: a.total_cost_paise })})`;
      if (a.status !== b.status) return `${s(a.status) === 'open' ? 'opened' : s(a.status)} event “${s(a.title)}”`;
      break;
    case 'auth':
      if (r.action === 'reset_password') return `reset password of ${s((a as J).username)}`;
      if (r.action === 'bulk_create_logins') return `created ${s((a as J).count)} flat logins`;
      break;
    case 'memberships_force':
      break;
  }
  if (r.action === 'force_sign_out') return 'signed out all devices of a member';
  if (r.action === 'purge_locations') return `purged acknowledgement locations older than ${s(a.older_than_days)} days`;
  const what = TABLE_LABELS[r.table_name] ?? r.table_name;
  return `${r.action === 'insert' ? 'added' : r.action === 'update' ? 'updated' : r.action === 'delete' ? 'deleted' : r.action} ${what}`;
}

export function changedKeys(before: J, after: J): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !['updated_at', 'created_at'].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

/** Actions that deserve a second look */
export function auditRisk(r: AuditRow): string | null {
  const a = (r.after ?? {}) as J;
  const b = (r.before ?? {}) as J;
  if (r.table_name === 'ledger_entries' && a.reverses_entry_id) return 'Reversal';
  if (r.table_name === 'ledger_entries' && r.action === 'insert' && a.entry_date && a.created_at) {
    const days = (Date.parse(s(a.created_at)) - Date.parse(s(a.entry_date) + 'T00:00:00+05:30')) / 86400000;
    if (days > 8) return 'Backdated';
  }
  if (r.table_name === 'society_settings' && r.action === 'update') return changedKeys(b, a).some((k) => k.startsWith('upi') || k === 'bank_account_name') ? 'Payment details' : 'Settings';
  if (r.table_name === 'memberships' && r.action === 'update' && a.role !== b.role) return 'Role change';
  if (r.table_name === 'month_closings' && a.reopened_at && !b.reopened_at) return 'Month reopened';
  if (r.table_name === 'role_permissions') return 'Permissions';
  if (r.action === 'reset_password' || r.action === 'force_sign_out') return 'Account security';
  return null;
}
