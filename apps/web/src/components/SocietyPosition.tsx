import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';

type Fund = { id: string; name: string; kind: string; scope_label: string | null; balance_paise: number; pending_paise: number; advance_paise: number };
type Scoped = { label: string; balance_paise: number; pending_paise: number; advance_paise: number };
type Pos = { funds: Fund[]; totals: { balance_paise: number; pending_paise: number; overdue_paise: number; advance_paise: number }; scoped: Scoped[] };

/** Society-wide balance, pending and advance, for every member. Display only. */
export function SocietyPosition() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useQuery({ queryKey: ['dashboard', 'position', m.societyId], queryFn: () => rpc<Pos>('society_position', { p_society: m.societyId }) });
  const [all, setAll] = useState(false);
  const p = q.data;
  if (!p) return null;
  const overall = p.funds.filter((f) => !f.scope_label);
  const shownFunds = all ? overall : overall.slice(0, 3);
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
        {shownFunds.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="mb-1 truncate text-sm font-semibold">{f.name}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Balance')} v={f.balance_paise} />
              <Stat label={t('Pending')} v={f.pending_paise} />
              <Stat label={t('Paid in advance')} v={f.advance_paise} />
            </div>
          </div>
        ))}
        {overall.length > 3 && (
          <button type="button" className="w-full cursor-pointer px-4 py-2.5 text-center text-[13px] font-semibold text-primary" onClick={() => setAll((v) => !v)}>
            {all ? t('Show less') : t('Show all {{n}}', { n: overall.length })}
          </button>
        )}
        {p.scoped.map((g) => (
          <div key={g.label} className="bg-muted/30 px-4 py-3">
            <p className="mb-1 truncate text-sm font-semibold">{t('Only for {{t}} events', { t: g.label })}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Balance')} v={g.balance_paise} />
              <Stat label={t('Pending')} v={g.pending_paise} />
              <Stat label={t('Paid in advance')} v={g.advance_paise} />
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('Not included in the overall figures above.')}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}
