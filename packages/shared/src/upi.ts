import { periodLabel } from './period';

/** Transaction note: P3-FF-OCT-2026 (or P3-FF-MOTOR-REPAIR for events), max 30 chars, safe characters only */
export function upiTransactionNote(unitCode: string, opts: { period?: string | null; eventTitle?: string | null }): string {
  let suffix = '';
  if (opts.period) suffix = periodLabel(opts.period).replace(' ', '-').toUpperCase();
  else if (opts.eventTitle)
    suffix = opts.eventTitle
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 16);
  return [unitCode.toUpperCase(), suffix].filter(Boolean).join('-').slice(0, 30);
}

/** upi://pay deep link that opens GPay / PhonePe / Paytm. Amount is in paise. */
export function buildUpiLink(p: { upiId: string; payeeName: string; amountPaise: number; note: string }): string {
  const am = (p.amountPaise / 100).toFixed(2);
  // Keep "@" readable in the VPA: some UPI apps reject an encoded %40.
  const enc = (v: string) => encodeURIComponent(v).replace(/%40/g, '@');
  return `upi://pay?pa=${enc(p.upiId)}&pn=${enc(p.payeeName)}&am=${am}&cu=INR&tn=${enc(p.note)}`;
}

export function isMobileDevice(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}
