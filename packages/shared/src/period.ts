/** Dates are shown in Asia/Kolkata. A "period" is a calendar month in IST keyed 'YYYY-MM'. */

export const TZ = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const isoDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today's date in IST as YYYY-MM-DD */
export function istToday(now: Date = new Date()): string {
  return isoDateFmt.format(now);
}

/** Convert any instant to its IST calendar date (YYYY-MM-DD) */
export function istDateOf(instant: string | Date): string {
  return isoDateFmt.format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function isValidPeriod(p: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export function currentPeriod(now: Date = new Date()): string {
  return istToday(now).slice(0, 7);
}

export function periodOfDate(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function periodLabel(p: string, long = false): string {
  const [y, m] = p.split('-').map(Number);
  const name = MONTHS[(m ?? 1) - 1] ?? '';
  return long ? `${new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, 1)).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' })} ${y}` : `${name} ${y}`;
}

export function addMonths(p: string, n: number): string {
  const [y, m] = p.split('-').map(Number);
  const idx = (y ?? 2000) * 12 + ((m ?? 1) - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Inclusive list of periods from `from` to `to` */
export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let p = from;
  let guard = 0;
  while (p <= to && guard++ < 600) {
    out.push(p);
    p = addMonths(p, 1);
  }
  return out;
}

/** Indian financial year (Apr–Mar) of a date: 2026-10-07 -> "2026-27" */
export function fyOf(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** "07 Oct 2026" from YYYY-MM-DD (calendar date, no timezone shift) */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const d = isoDate.length > 10 ? istDateOf(isoDate) : isoDate;
  const [y, m, day] = d.split('-');
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
}

const dtFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "07 Oct 2026, 18:42" in IST from an ISO timestamp */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return dtFmt.format(new Date(iso)).replace(/ (am|pm)$/i, '');
}

/** Days between two YYYY-MM-DD dates (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

export function addDays(isoDate: string, n: number): string {
  const d = new Date(Date.parse(isoDate + 'T00:00:00Z') + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** "2 h ago", "3 d ago" */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
