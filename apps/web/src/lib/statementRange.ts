import { addDays, istToday } from '@harmony/shared';
import { addMonths, currentPeriod, periodEnd, periodStart } from '@/lib/format';

export type RangeKey =
  'this_month' | 'month' | 'last_month' | '3' | '6' | '9' | '12' | 'fy' | 'all' | 'custom';

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'month', label: 'A particular month…' },
  { key: '3', label: 'Last 3 months' },
  { key: '6', label: 'Last 6 months' },
  { key: '9', label: 'Last 9 months' },
  { key: '12', label: 'Last 12 months' },
  { key: 'fy', label: 'This financial year (Apr–Mar)' },
  { key: 'all', label: 'Everything — from the start' },
  { key: 'custom', label: 'Custom dates…' },
];

/** The same calendar day N months earlier (31 Aug − 6 months → 28/29 Feb), as YYYY-MM-DD. */
function monthsBack(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) - n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** `from` is null for "from the start" (the server uses the first entry). */
export function resolveRange(
  key: RangeKey,
  custom: { from: string; to: string; month?: string },
): { from: string | null; to: string } {
  const today = istToday();
  switch (key) {
    case 'this_month':
      return { from: periodStart(currentPeriod()), to: today };
    case 'month': {
      const p = custom.month || currentPeriod();
      const end = periodEnd(p);
      return { from: periodStart(p), to: end > today ? today : end };
    }
    case 'last_month': {
      const p = addMonths(currentPeriod(), -1);
      return { from: periodStart(p), to: periodEnd(p) };
    }
    case '3':
    case '6':
    case '9':
    case '12':
      return { from: addDays(monthsBack(today, Number(key)), 1), to: today };
    case 'fy': {
      const [y, m] = today.split('-').map(Number);
      return { from: `${m >= 4 ? y : y - 1}-04-01`, to: today };
    }
    case 'all':
      return { from: null, to: today };
    default:
      return custom;
  }
}

export function validateRange(r: { from: string | null; to: string }): string | null {
  const today = istToday();
  if (!r.to || r.from === '') return 'Choose both dates.';
  if (r.to > today) return 'The end date cannot be in the future.';
  if (r.from && r.from > r.to) return 'The start date must be on or before the end date.';
  return null;
}
