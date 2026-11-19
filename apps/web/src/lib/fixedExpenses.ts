import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/supabase';

/** One unpaid recurring payment (e.g. the guard's salary for one month), as the admin sees it. */
export type PendingFixed = {
  draft_id: string;
  template_id: string;
  title: string;
  period: string;
  period_label: string;
  amount_paise: number;
  day_of_month: number;
  skippable: boolean;
  overdue: boolean;
  late_if_paid_today: boolean;
  can_skip: boolean;
  can_report_blocked: boolean;
  fund_id: string | null;
  balance_paise: number;
  shortfall_paise: number;
};

/** Every unpaid month of every recurring payment, oldest first. Admins only. */
export function usePendingFixed(societyId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['pendingFixed', societyId],
    enabled,
    staleTime: 0,
    queryFn: () => rpc<PendingFixed[]>('pending_fixed_expenses', { p_society: societyId }),
  });
}

/** An extra payment from one flat towards a short-fall. */
export type Contribution = { unit_id: string; amount: string; ref: string };

/** Modes that need a UTR / reference number. */
export const MODE_NEEDS_REF = (mode: string) => !['cash', 'cheque', 'other'].includes(mode);

/** "Split equally": whole rupees for everyone, the odd paise go to the first flats. */
export function splitEqually(totalPaise: number, count: number): number[] {
  if (count <= 0 || totalPaise <= 0) return [];
  const base = Math.floor(totalPaise / count);
  const extra = totalPaise - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Salary is paid in arrears: the draft for "2026-11" pays for 1 October – 31 October 2026. */
export function servicePeriod(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(py, pm, 0).getDate();
  return { from: `1 ${MONTHS[pm - 1]} ${py}`, to: `${last} ${MONTHS[pm - 1]} ${py}` };
}
