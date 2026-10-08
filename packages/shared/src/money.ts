/** Money is always integer paise. Never use floats for stored amounts. */

export const MAX_ENTRY_PAISE = 1_000_000_000; // ₹1,00,00,000 (1 crore)

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const inrFraction = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plainNumber = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹2,40,000 — shows paise only when present. `sign` adds +/− (never rely on colour alone). */
export function formatINR(paise: number | bigint | null | undefined, opts: { sign?: boolean } = {}): string {
  const p = Number(paise ?? 0);
  if (!Number.isFinite(p)) return '₹0';
  const abs = Math.abs(p);
  const body = abs % 100 === 0 ? inrWhole.format(abs / 100) : inrFraction.format(abs / 100);
  if (opts.sign) return (p > 0 ? '+' : p < 0 ? '−' : '') + body;
  return p < 0 ? '−' + body : body;
}

/** Compact form for charts: ₹2.4L, ₹15K */
export function formatINRCompact(paise: number): string {
  const r = Math.abs(paise) / 100;
  const sign = paise < 0 ? '−' : '';
  if (r >= 1e7) return `${sign}₹${trim(r / 1e7)}Cr`;
  if (r >= 1e5) return `${sign}₹${trim(r / 1e5)}L`;
  if (r >= 1e3) return `${sign}₹${trim(r / 1e3)}K`;
  return `${sign}₹${plainNumber.format(r)}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * Parse what a person types ("1,500", "800.50", "₹ 2,40,000") into integer paise.
 * Returns null for anything that is not a positive amount with at most 2 decimals.
 */
export function parseRupeesToPaise(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}

/** For pre-filling inputs: 80000 -> "800", 80050 -> "800.50" */
export function paiseToInput(paise: number | null | undefined): string {
  if (!paise) return '';
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return p === 0 ? String(rupees) : `${rupees}.${String(p).padStart(2, '0')}`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/** Indian numbering: 24000000 paise -> "Rupees Two Lakh Forty Thousand Only" */
export function amountInWords(paise: number): string {
  const total = Math.abs(Math.trunc(paise));
  let rupees = Math.floor(total / 100);
  const p = total % 100;
  if (rupees === 0 && p === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5);
  rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3);
  rupees %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));
  let out = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (p) out += ` and ${twoDigits(p)} Paise`;
  return `${out} Only`;
}
