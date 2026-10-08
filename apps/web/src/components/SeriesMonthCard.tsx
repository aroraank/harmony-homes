import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addMonths, currentPeriod, formatDate, formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { Card } from '@/components/ui/card';

type Prog = { period: string; event_id: string; events: number; title: string; due_date: string; expected_paise: number; collected_paise: number; paid: number; partial: number; pending: number; waived: number };

/** The month that is being collected now is last month's (it is due next month); shown instead of the running month. */
export function SeriesMonthCard() {
  const { t } = useTranslation();
  const m = useMember();
  const period = addMonths(currentPeriod(), -1);
  const q = useQuery({ queryKey: ['eventsOverview', m.societyId, 'monthProgress', period], queryFn: () => rpc<Prog | null>('series_month_progress', { p_society: m.societyId, p_period: period }) });
  const p = q.data;
  if (!p) return null;
  const pct = p.expected_paise ? Math.min(100, Math.round((p.collected_paise / p.expected_paise) * 100)) : 0;
  return (
    <Link to={p.events === 1 ? `/events/${p.event_id}` : '/events'} className="block">
      <Card className="p-4 transition-colors hover:bg-secondary/40">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold">{t('{{m}} collection', { m: periodLabel(period) })}</p>
            <p className="text-[12px] text-muted-foreground">{t('Due {{d}}', { d: formatDate(p.due_date) })}</p>
          </div>
          <span className="text-[13px] font-semibold text-primary">{pct}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-500 to-lime-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="tabular mt-2 flex justify-between text-[13px]">
          <span>
            <strong>{formatINR(p.collected_paise)}</strong> <span className="text-muted-foreground">{t('collected')}</span>
          </span>
          <span className="text-muted-foreground">
            {t('of')} {formatINR(p.expected_paise)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {(
            [
              [t('Paid'), p.paid, 'text-credit'],
              [t('Partial'), p.partial, 'text-warning'],
              [t('Pending'), p.pending, 'text-debit'],
              [t('Waived'), p.waived, 'text-muted-foreground'],
            ] as const
          ).map(([label, n, cls]) => (
            <div key={label} className="rounded-xl bg-muted/50 py-2">
              <p className={`tabular text-lg font-extrabold ${cls}`}>{n}</p>
              <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </Card>
    </Link>
  );
}
