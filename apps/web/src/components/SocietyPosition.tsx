import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';

type Fund = { id: string; name: string; kind: string; balance_paise: number; pending_paise: number; advance_paise: number };
type Pos = { funds: Fund[]; totals: { balance_paise: number; pending_paise: number; overdue_paise: number; advance_paise: number } };

/** Society-wide balance, pending and advance, for every member. Display only. */
export function SocietyPosition() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useQuery({ queryKey: ['dashboard', 'position', m.societyId], queryFn: () => rpc<Pos>('society_position', { p_society: m.societyId }) });
  const p = q.data;
  if (!p) return null;
  const Stat = ({ label, v, cls }: { label: string; v: number; cls?: string }) => (
    <div className="min-w-0">
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={`tabular text-sm font-bold ${cls ?? ''}`}>{formatINR(v)}</p>
    </div>
  );
  return (
    <section>
      <SectionTitle>{t('Society position')}</SectionTitle>
      <Card className="divide-y">
        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          <Stat label={t('Balance')} v={p.totals.balance_paise} />
          <Stat label={t('Pending')} v={p.totals.pending_paise} cls="text-warning" />
          <Stat label={t('Paid in advance')} v={p.totals.advance_paise} cls="text-credit" />
        </div>
        {p.funds.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="mb-1 truncate text-sm font-semibold">{f.name}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Balance')} v={f.balance_paise} />
              <Stat label={t('Pending')} v={f.pending_paise} />
              <Stat label={t('Paid in advance')} v={f.advance_paise} />
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}
