import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatINR, istToday } from '@harmony/shared';
import { rpc } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';

type Due = { id: string; label: string; event_id: string | null; due_date: string; amount_paise: number; paid_paise: number; pending_paise: number; waived: boolean };

/** Every unpaid month / event for the signed-in member's flat, oldest first, with the total at the end. */
export function MyPending({ unitId }: { unitId: string }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['unitStatement', unitId, 'pending'], queryFn: () => rpc<{ dues: Due[] }>('unit_statement', { p_unit_id: unitId }) });
  const rows = (q.data?.dues ?? []).filter((d) => !d.waived && d.pending_paise > 0).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (rows.length === 0) return null;
  const total = rows.reduce((s, d) => s + d.pending_paise, 0);
  const today = istToday();
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <section>
      <SectionTitle>{t('Your pending payments')}</SectionTitle>
      <Card className="divide-y">
        {shown.map((d) => {
          const overdue = d.due_date < today;
          const Row = (
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{d.label}</p>
                <p className="text-[12px] text-muted-foreground">
                  {t('Due {{d}}', { d: formatDate(d.due_date) })}
                  {d.paid_paise > 0 ? ` · ${t('{{a}} paid', { a: formatINR(d.paid_paise) })}` : ''}
                </p>
              </div>
              {overdue && <Badge variant="danger">{t('Overdue')}</Badge>}
              <span className={cn('tabular font-bold', overdue ? 'text-debit' : '')}>{formatINR(d.pending_paise)}</span>
            </div>
          );
          return d.event_id ? (
            <Link key={d.id} to={`/events/${d.event_id}`} className="block hover:bg-secondary/50">
              {Row}
            </Link>
          ) : (
            <div key={d.id}>{Row}</div>
          );
        })}
        {rows.length > 6 && (
          <button type="button" className="w-full cursor-pointer px-4 py-2.5 text-center text-[13px] font-semibold text-primary" onClick={() => setAll((v) => !v)}>
            {all ? t('Show less') : t('Show all {{n}}', { n: rows.length })}
          </button>
        )}
        <div className="flex items-center justify-between bg-muted/40 px-4 py-3">
          <span className="text-sm font-bold">{t('Total pending')}</span>
          <span className="tabular text-lg font-extrabold text-debit">{formatINR(total)}</span>
        </div>
      </Card>
    </section>
  );
}
