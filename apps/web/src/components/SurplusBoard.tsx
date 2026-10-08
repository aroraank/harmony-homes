import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HeartHandshake } from 'lucide-react';
import { formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';

type Row = { unit_id: string; unit_code: string; unit_name: string; advance_paise: number; event_advance_paise: number };

/** Flats that have paid more than they owe. Shown to every member; flats that owe are never listed here. */
export function SurplusBoard() {
  const { t } = useTranslation();
  const m = useMember();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ['dashboard', 'surplus', m.societyId], queryFn: () => rpc<Row[]>('surplus_board', { p_society: m.societyId }) });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section>
      <SectionTitle>{t('Paid in advance — thank you')}</SectionTitle>
      <Card className="divide-y">
        {shown.map((r) => {
          const mine = r.unit_id === m.unit_id;
          return (
            <div key={r.unit_id} className={cn('flex items-center gap-3 px-4 py-3', mine && 'bg-secondary/60')}>
              <HeartHandshake className="size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  <span className="tabular">{r.unit_code}</span>
                  {mine && <span className="ml-2 text-[12px] font-bold text-primary">{t('You')}</span>}
                </p>
                {r.event_advance_paise > 0 && <p className="text-[12px] text-muted-foreground">{t('incl. {{a}} for events', { a: formatINR(r.event_advance_paise) })}</p>}
              </div>
              <span className="tabular font-bold text-credit">{formatINR(r.advance_paise + r.event_advance_paise)}</span>
            </div>
          );
        })}
        {rows.length > 5 && (
          <button type="button" className="w-full cursor-pointer px-4 py-2.5 text-center text-[13px] font-semibold text-primary" onClick={() => setAll((v) => !v)}>
            {all ? t('Show less') : t('Show all {{n}}', { n: rows.length })}
          </button>
        )}
      </Card>
    </section>
  );
}
