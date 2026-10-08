export {
  addDays,
  addMonths,
  currentPeriod,
  daysBetween,
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  istToday,
  periodLabel,
  periodsBetween,
  relativeAge,
} from '@harmony/shared';

/** First day of a 'YYYY-MM' period as YYYY-MM-DD */
export function periodStart(p: string): string {
  return `${p}-01`;
}

/** Last day of a 'YYYY-MM' period as YYYY-MM-DD */
export function periodEnd(p: string): string {
  const [y, m] = p.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).getUTCDate();
  return `${p}-${String(last).padStart(2, '0')}`;
}
