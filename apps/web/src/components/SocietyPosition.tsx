import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleHelp } from 'lucide-react';
import { addMonths, currentPeriod, formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';

export type Fund = { event_id?: string | null; ord?: string; earlier_balance_paise?: number; id: string; name: string; kind: string; scope_label: string | null; balance_paise: number; pending_paise: number; advance_paise: number };
export type Scoped = { label: string; balance_paise: number; pending_paise: number; advance_paise: number };
export type Pos = { funds: Fund[]; totals: { balance_paise: number; pending_paise: number; overdue_paise: number; advance_paise: number }; scoped: Scoped[] };

export function usePosition() {
  const m = useMember();
  return useQuery({ queryKey: ['dashboard', 'position', m.societyId], queryFn: () => rpc<Pos>('society_position', { p_society: m.societyId }) });
}

/** Society-wide balance, pending and advance, for every member. Display only. */
export function SocietyPosition() {
  const { t } = useTranslation();
  const m = useMember();
  const q = usePosition();
  const [all, setAll] = useState(false);
  const [tip, setTip] = useState<null | 'bal' | 'pend' | 'adv'>(null);
  const p = q.data;
  if (!p) return null;
  const prev = addMonths(currentPeriod(), -1);
  const base = p.funds.filter((f) => !f.scope_label && !(f.kind === 'general' && !f.balance_paise && !f.pending_paise && !f.advance_paise));
  // Members see older months' leftovers as one tidy row; admins see every month.
  const isOld = (f: Fund) => !m.isAdmin && f.kind === 'event' && !!f.ord && f.ord < prev;
  const old = base.filter(isOld);
  const sum = (k: 'balance_paise' | 'pending_paise' | 'advance_paise') => old.reduce((s, f) => s + f[k], 0);
  const ords = old.map((f) => f.ord as string).sort();
  const overall: Fund[] = [
    ...base.filter((f) => !isOld(f)),
    ...(old.length ? [{ id: 'earlier', name: `${t('Earlier months')} (${periodLabel(ords[0]!)}${ords.length > 1 && ords[0] !== ords[ords.length - 1] ? ' – ' + periodLabel(ords[ords.length - 1]!) : ''})`, kind: 'event', scope_label: null, balance_paise: sum('balance_paise'), pending_paise: sum('pending_paise'), advance_paise: sum('advance_paise') } as Fund] : []),
  ];
  const TIPS = {
    bal: t('What is left in the event funds after spending: collections for September 2026 onwards minus expenses. Earlier months are counted as ₹0.'),
    pend: t('Amount billed to flats that has not been paid yet.'),
    adv: t('Money paid by flats beyond what is billed so far. It is adjusted against their future dues.'),
  } as const;
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
        <div className="px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {([['bal', t('Surplus'), p.totals.balance_paise, ''], ['pend', t('Yet to collect'), p.totals.pending_paise, 'text-warning'], ['adv', t('Advance received'), p.totals.advance_paise, 'text-credit']] as const).map(([k, label, v, cls]) => (
              <div key={k} className="min-w-0">
                <button type="button" onClick={() => setTip(tip === k ? null : k)} aria-label={label} className="flex cursor-pointer items-center gap-1 text-[11.5px] text-muted-foreground">
                  {label} <CircleHelp className="size-3.5" />
                </button>
                <p className={`tabular text-sm font-bold ${cls}`}>{formatINR(v)}</p>
              </div>
            ))}
          </div>
          {tip && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">{TIPS[tip]}</p>}
        </div>
        {shownFunds.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="mb-1 truncate text-sm font-semibold">{f.name}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Surplus')} v={f.balance_paise} />
              <Stat label={t('Yet to collect')} v={f.pending_paise} />
              <Stat label={t('Advance received')} v={f.advance_paise} />
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
              <Stat label={t('Surplus')} v={g.balance_paise} />
              <Stat label={t('Yet to collect')} v={g.pending_paise} />
              <Stat label={t('Advance received')} v={g.advance_paise} />
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">{t('Not included in the overall figures above.')}</p>
          </div>
        ))}
      </Card>
    </section>
  );
}
