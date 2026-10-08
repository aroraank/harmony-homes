/**
 * Client-side mirror of the database allocation rule (public._allocate / preview_allocation):
 * a payment settles the oldest unpaid, non-waived dues first; anything left is advance credit.
 * The server is the source of truth — this exists for instant previews and unit tests.
 */
export interface DueForAllocation {
  id: string;
  label: string;
  amountPaise: number;
  paidPaise: number;
  dueDate: string; // YYYY-MM-DD
  waived?: boolean;
}

export interface AllocationLine {
  dueId: string;
  label: string;
  amountPaise: number;
  settlesFully: boolean;
}

export interface AllocationPreview {
  lines: AllocationLine[];
  advancePaise: number;
}

export function previewAllocation(dues: DueForAllocation[], paymentPaise: number): AllocationPreview {
  let remaining = Math.max(0, Math.trunc(paymentPaise));
  const lines: AllocationLine[] = [];
  const ordered = [...dues]
    .filter((d) => !d.waived && d.amountPaise - d.paidPaise > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  for (const d of ordered) {
    if (remaining <= 0) break;
    const open = d.amountPaise - d.paidPaise;
    const take = Math.min(open, remaining);
    lines.push({ dueId: d.id, label: d.label, amountPaise: take, settlesFully: take === open });
    remaining -= take;
  }
  return { lines, advancePaise: remaining };
}

/** "covers Sep ₹800 + Oct ₹800, ₹200 advance" */
export function describeAllocation(p: AllocationPreview, fmt: (paise: number) => string): string {
  const parts = p.lines.map((l) => `${l.label} ${fmt(l.amountPaise)}${l.settlesFully ? '' : ' (part)'}`);
  let s = parts.length ? `covers ${parts.join(' + ')}` : 'no pending dues';
  if (p.advancePaise > 0) s += `, ${fmt(p.advancePaise)} advance`;
  return s;
}

export type UnitStatus = 'paid' | 'partial' | 'pending' | 'advance' | 'waived' | 'none';

export function unitStatusFor(duePaise: number, paidPaise: number, advancePaise: number, waived: boolean): UnitStatus {
  if (waived) return 'waived';
  if (duePaise <= 0) return advancePaise > 0 ? 'advance' : 'none';
  if (paidPaise >= duePaise) return advancePaise > 0 ? 'advance' : 'paid';
  if (paidPaise > 0) return 'partial';
  return 'pending';
}
