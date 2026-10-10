import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatINR, istToday, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import type { Fund, Pos } from './SocietyPosition';

export type Breakdown = {
  fund_id: string;
  collected_paise: number;
  payments_count: number;
  spent_paise: number;
  other_paise: number;
  expenses: { date: string; label: string; amount_paise: number }[];
  pending: { flat: string | null; mine: boolean; amount_paise: number }[];
};

export function useBreakdown(enabled = true) {
  const m = useMember();
  return useQuery({
    queryKey: ['dashboard', 'positionBreakdown', m.societyId],
    enabled,
    queryFn: () => rpc<Breakdown[]>('society_position_breakdown', { p_society: m.societyId }),
  });
}

// ---------------------------------------------------------------------------
// Old-school printed-slip look: small mono capitals, dotted rule under every line.
// ---------------------------------------------------------------------------
const money = (v: number) => `${v < 0 ? '- ' : ''}${formatINR(Math.abs(v))}`;

export function Receipt({ children }: { children: ReactNode }) {
  return (
    <div className="relative mt-2 overflow-hidden rounded-sm border border-dashed border-stone-300 bg-[#fffdf2] px-3 pb-3 pt-2.5 font-mono text-[11px] uppercase leading-snug tracking-tight text-stone-700 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300">
      {children}
    </div>
  );
}

export function RHead({ children }: { children: ReactNode }) {
  return <p className="mb-0.5 mt-2.5 text-center font-bold first:mt-0">*** {children} ***</p>;
}

export function RLine({ label, value, muted }: { label: ReactNode; value?: number; muted?: boolean }) {
  return (
    <div
      className={`flex items-end justify-between gap-3 border-b border-dotted border-stone-400/80 py-[3px] dark:border-stone-600 ${muted ? 'text-stone-500' : ''}`}
    >
      <span className="min-w-0 break-words">{label}</span>
      {value !== undefined && <span className="tabular shrink-0">{money(value)}</span>}
    </div>
  );
}

export function RTotal({ label, value }: { label: ReactNode; value: number }) {
  return (
    <div className="mt-1 flex items-end justify-between gap-3 border-y-[3px] border-double border-stone-500 py-1 font-bold text-stone-900 dark:border-stone-400 dark:text-stone-100">
      <span className="min-w-0 break-words">{label}</span>
      <span className="tabular shrink-0">{money(value)}</span>
    </div>
  );
}

export function RNote({ children }: { children: ReactNode }) {
  return <p className="pt-1 text-[10.5px] normal-case italic text-stone-500">{children}</p>;
}

function RFooter({ society }: { society: string }) {
  return (
    <p className="mt-2 text-center text-[10px] text-stone-500">
      - - - {society} · {formatDate(istToday())} - - -
    </p>
  );
}

/** Pending lines: admins see every flat; members see their own flat and one total for the rest. */
function PendingLines({ b }: { b: Breakdown }) {
  const { t } = useTranslation();
  const named = b.pending.filter((x) => x.flat);
  const hidden = b.pending.filter((x) => !x.flat);
  return (
    <>
      {named.map((x, i) => (
        <RLine
          key={`${x.flat}-${i}`}
          label={x.mine ? `${x.flat} (${t('your flat')})` : (x.flat as string)}
          value={x.amount_paise}
        />
      ))}
      {hidden.length > 0 && (
        <RLine
          label={
            named.length
              ? t('Other flats ({{n}})', { n: hidden.length })
              : t('{{n}} flats', { n: hidden.length })
          }
          value={hidden.reduce((s, x) => s + x.amount_paise, 0)}
        />
      )}
      {b.pending.length === 0 && <RLine label={t('Nothing pending')} value={0} muted />}
    </>
  );
}

/** One fund: how its balance is made, who still has to pay, and advance. */
export function FundReceipt({ f, b, society }: { f: Fund; b: Breakdown | undefined; society: string }) {
  const { t } = useTranslation();
  if (!b) return null;
  const held = b.collected_paise - b.spent_paise + b.other_paise;
  const counted = f.counted !== false;
  const pendingTotal = b.pending.reduce((s, x) => s + x.amount_paise, 0);
  return (
    <Receipt>
      <RHead>{t('How the balance is made')}</RHead>
      <RLine
        label={t('Collected from flats ({{n}} payments)', { n: b.payments_count })}
        value={b.collected_paise}
      />
      {b.expenses.map((x, i) => (
        <RLine key={i} label={`${t('Less')}: ${x.label} · ${formatDate(x.date)}`} value={-x.amount_paise} />
      ))}
      {b.expenses.length === 0 && <RLine label={`${t('Less')}: ${t('spent')}`} value={0} muted />}
      {b.other_paise !== 0 && <RLine label={t('Transfers / adjustments')} value={b.other_paise} />}
      <RTotal label={counted ? t('Balance') : t('Money held')} value={held} />
      {!counted && (
        <RNote>
          {t('This month is before September 2026, so it is not added to the society balance (shown as ₹0).')}
        </RNote>
      )}

      <RHead>{t('Yet to collect')}</RHead>
      <PendingLines b={b} />
      <RTotal label={t('Total ({{n}} flats)', { n: b.pending.length })} value={pendingTotal} />

      <RHead>{t('Advance')}</RHead>
      <RLine label={t('Paid in advance by flats')} value={f.advance_paise} />
      <RFooter society={society} />
    </Receipt>
  );
}

/** Members' combined "Earlier months" row: one short block per month. */
export function EarlierReceipt({
  parts,
  map,
  society,
}: {
  parts: Fund[];
  map: Map<string, Breakdown>;
  society: string;
}) {
  const { t } = useTranslation();
  const rows = [...parts].sort((a, b) => (a.ord ?? '').localeCompare(b.ord ?? ''));
  let collected = 0;
  let pending = 0;
  return (
    <Receipt>
      {rows.map((f) => {
        const b = map.get(f.id);
        if (!b) return null;
        const p = b.pending.reduce((s, x) => s + x.amount_paise, 0);
        collected += b.collected_paise - b.spent_paise + b.other_paise;
        pending += p;
        return (
          <div key={f.id}>
            <RHead>{f.ord ? periodLabel(f.ord) : f.name}</RHead>
            <RLine
              label={t('Late money received')}
              value={b.collected_paise - b.spent_paise + b.other_paise}
            />
            <PendingLines b={b} />
            {b.pending.length > 0 && (
              <RTotal label={t('To collect ({{n}} flats)', { n: b.pending.length })} value={p} />
            )}
          </div>
        );
      })}
      <RHead>{t('Earlier months total')}</RHead>
      <RLine label={t('Late money received (not in balance)')} value={collected} />
      <RTotal label={t('Yet to collect')} value={pending} />
      <RNote>{t('Months before September 2026 are not added to the society balance.')}</RNote>
      <RFooter society={society} />
    </Receipt>
  );
}

/** Top slip: the overall figures as a sum of each fund. */
export function TotalsReceipt({ p, overall, society }: { p: Pos; overall: Fund[]; society: string }) {
  const { t } = useTranslation();
  const name = (f: Fund) => (f.kind === 'general' ? t('General') : f.name);
  return (
    <Receipt>
      <RHead>{t('Society balance')}</RHead>
      {overall.map((f) => (
        <RLine key={f.id} label={name(f)} value={f.balance_paise} />
      ))}
      <RTotal label={t('Balance')} value={p.totals.balance_paise} />
      <RHead>{t('Yet to collect')}</RHead>
      {overall.map((f) => (
        <RLine key={f.id} label={name(f)} value={f.pending_paise} />
      ))}
      <RTotal label={t('Yet to collect')} value={p.totals.pending_paise} />
      <RHead>{t('Advance')}</RHead>
      <RTotal label={t('Advance received')} value={p.totals.advance_paise} />
      {p.scoped.length > 0 && (
        <RNote>{t('Flat-type-only events (e.g. 3BHK) are separate and not included here.')}</RNote>
      )}
      <RFooter society={society} />
    </Receipt>
  );
}
