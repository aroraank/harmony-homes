import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight, CircleHelp, FileDown, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { addMonths, currentPeriod, formatDate, formatINR, istToday, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { pdfINR, reportPdf } from '@/lib/pdf';
import { downloadBlob } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { EarlierReceipt, FundReceipt, TotalsReceipt, useBreakdown } from '@/components/PositionReceipt';

export type Fund = {
  counted?: boolean;
  event_id?: string | null;
  ord?: string;
  earlier_balance_paise?: number;
  id: string;
  name: string;
  kind: string;
  scope_label: string | null;
  balance_paise: number;
  pending_paise: number;
  advance_paise: number;
  /** for the combined 'Earlier months' row: the months it adds up */
  parts?: Fund[];
};
export type Scoped = { label: string; balance_paise: number; pending_paise: number; advance_paise: number };
export type Pos = {
  funds: Fund[];
  totals: { balance_paise: number; pending_paise: number; overdue_paise: number; advance_paise: number };
  scoped: Scoped[];
};

export function usePosition() {
  const m = useMember();
  return useQuery({
    queryKey: ['dashboard', 'position', m.societyId],
    queryFn: () => rpc<Pos>('society_position', { p_society: m.societyId }),
  });
}

/** Society-wide balance, pending and advance, for every member. Display only. */
/** The society-wide fund list every view uses, so all pages always show the same numbers. */
export function buildOverall(p: Pos, isAdmin: boolean, earlierLabel: string): Fund[] {
  const prev = addMonths(currentPeriod(), -1);
  const base = p.funds.filter(
    (f) =>
      !f.scope_label && !(f.kind === 'general' && !f.balance_paise && !f.pending_paise && !f.advance_paise),
  );
  // Members see older months' leftovers as one tidy row; admins see every month.
  const isOld = (f: Fund) => !isAdmin && f.kind === 'event' && !!f.ord && f.ord < prev;
  const old = base.filter(isOld);
  const sum = (k: 'balance_paise' | 'pending_paise' | 'advance_paise') => old.reduce((s, f) => s + f[k], 0);
  const ords = old.map((f) => f.ord as string).sort();
  return [
    ...base.filter((f) => !isOld(f)),
    ...(old.length
      ? [
          {
            id: 'earlier',
            name: `${earlierLabel} (${periodLabel(ords[0]!)}${ords.length > 1 && ords[0] !== ords[ords.length - 1] ? ' – ' + periodLabel(ords[ords.length - 1]!) : ''})`,
            kind: 'event',
            scope_label: null,
            balance_paise: sum('balance_paise'),
            pending_paise: sum('pending_paise'),
            advance_paise: sum('advance_paise'),
            parts: old,
          } as Fund,
        ]
      : []),
  ];
}

export function SocietyPosition({
  expanded = false,
  hideTitle = false,
  withBreakdown = false,
}: { expanded?: boolean; hideTitle?: boolean; withBreakdown?: boolean } = {}) {
  const { t } = useTranslation();
  const m = useMember();
  const q = usePosition();
  const [all, setAll] = useState(expanded);
  const [tip, setTip] = useState<null | 'bal' | 'pend' | 'adv'>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const bq = useBreakdown(withBreakdown);
  const bmap = new Map((bq.data ?? []).map((b) => [b.fund_id, b]));
  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const ReceiptToggle = ({ id }: { id: string }) => (
    <button
      type="button"
      onClick={() => toggle(id)}
      className="mt-1.5 cursor-pointer text-[12px] font-semibold text-primary"
    >
      {closed.has(id) ? t('Show breakdown') : t('Hide breakdown')}
    </button>
  );
  const p = q.data;
  if (!p) return null;
  const overall = buildOverall(p, m.isAdmin, t('Earlier months'));
  const TIPS = {
    bal: t(
      'Money left after expenses, counting collections from September 2026 onwards. Money received for August 2026 and earlier months is not counted.',
    ),
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
      {!hideTitle && <SectionTitle>{t('Society position')}</SectionTitle>}
      <Card className="divide-y">
        <div className="px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ['bal', t('Balance'), p.totals.balance_paise, ''],
                ['pend', t('Yet to collect'), p.totals.pending_paise, 'text-warning'],
                ['adv', t('Advance received'), p.totals.advance_paise, 'text-credit'],
              ] as const
            ).map(([k, label, v, cls]) => (
              <div key={k} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setTip(tip === k ? null : k)}
                  aria-label={label}
                  className="flex cursor-pointer items-center gap-1 text-[11.5px] text-muted-foreground"
                >
                  {label} <CircleHelp className="size-3.5" />
                </button>
                <p className={`tabular text-sm font-bold ${cls}`}>{formatINR(v)}</p>
              </div>
            ))}
          </div>
          {tip && (
            <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              {TIPS[tip]}
            </p>
          )}
          {withBreakdown && (
            <>
              <ReceiptToggle id="__totals" />
              {!closed.has('__totals') && <TotalsReceipt p={p} overall={overall} society={m.society_name} />}
            </>
          )}
        </div>
        {shownFunds.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <p className="mb-1 break-words text-sm font-semibold">{f.name}</p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Balance')} v={f.balance_paise} />
              <Stat label={t('Yet to collect')} v={f.pending_paise} />
              <Stat label={t('Advance received')} v={f.advance_paise} />
            </div>
            {withBreakdown && bq.data && (
              <>
                <ReceiptToggle id={f.id} />
                {!closed.has(f.id) &&
                  (f.parts ? (
                    <EarlierReceipt parts={f.parts} map={bmap} society={m.society_name} />
                  ) : (
                    <FundReceipt f={f} b={bmap.get(f.id)} society={m.society_name} />
                  ))}
              </>
            )}
          </div>
        ))}
        {overall.length > 3 && (
          <button
            type="button"
            className="w-full cursor-pointer px-4 py-2.5 text-center text-[13px] font-semibold text-primary"
            onClick={() => setAll((v) => !v)}
          >
            {all ? t('Show less') : t('Show all {{n}}', { n: overall.length })}
          </button>
        )}
        {p.scoped.map((g) => (
          <div key={g.label} className="bg-muted/30 px-4 py-3">
            <p className="mb-1 break-words text-sm font-semibold">
              {t('Only for {{t}} events', { t: g.label })}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('Balance')} v={g.balance_paise} />
              <Stat label={t('Yet to collect')} v={g.pending_paise} />
              <Stat label={t('Advance received')} v={g.advance_paise} />
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {t('Not included in the overall figures above.')}
            </p>
            {withBreakdown && bq.data && (
              <>
                <ReceiptToggle id={`scoped-${g.label}`} />
                {!closed.has(`scoped-${g.label}`) &&
                  p.funds
                    .filter((f) => f.scope_label === g.label)
                    .map((f) => (
                      <div key={f.id}>
                        <p className="mt-2 break-words text-[12.5px] font-semibold">{f.name}</p>
                        <FundReceipt f={f} b={bmap.get(f.id)} society={m.society_name} />
                      </div>
                    ))}
              </>
            )}
          </div>
        ))}
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sharing: the same figures as a WhatsApp message or a PDF
// ---------------------------------------------------------------------------
const fundLabel = (f: Fund) => (f.kind === 'general' ? 'General' : f.name);

export function positionShareText(p: Pos, overall: Fund[], society: string): string {
  return [
    `*${society} — Society position*`,
    `As on ${formatDate(istToday())}`,
    '',
    `Balance: ${formatINR(p.totals.balance_paise)}`,
    `Yet to collect: ${formatINR(p.totals.pending_paise)}`,
    `Advance received: ${formatINR(p.totals.advance_paise)}`,
    '',
    ...overall.map(
      (f) =>
        `• ${fundLabel(f)} — balance ${formatINR(f.balance_paise)}, to collect ${formatINR(f.pending_paise)}`,
    ),
    ...p.scoped.map(
      (g) =>
        `• Only for ${g.label} events (separate) — balance ${formatINR(g.balance_paise)}, to collect ${formatINR(g.pending_paise)}`,
    ),
    '',
    'Balance = money left after expenses, counting collections from September 2026 onwards.',
    'Full details in the Harmony Homes app.',
  ].join('\n');
}

export function positionPdf(p: Pos, overall: Fund[], society: string): Promise<Blob> {
  return reportPdf(`Society position — ${formatDate(istToday())}`, society, [
    {
      title: 'Overall (all flats)',
      summary: [
        ['Balance', pdfINR(p.totals.balance_paise)],
        ['Yet to collect', pdfINR(p.totals.pending_paise)],
        ['Advance received', pdfINR(p.totals.advance_paise)],
      ],
    },
    {
      title: 'Each fund',
      table: {
        head: ['Fund', 'Balance', 'Yet to collect', 'Advance'],
        body: overall.map((f) => [
          fundLabel(f),
          pdfINR(f.balance_paise),
          pdfINR(f.pending_paise),
          pdfINR(f.advance_paise),
        ]),
      },
    },
    ...(p.scoped.length
      ? [
          {
            title: 'Separate — flat-type events',
            table: {
              head: ['Group', 'Balance', 'Yet to collect', 'Advance'],
              body: p.scoped.map((g) => [
                `Only for ${g.label} events`,
                pdfINR(g.balance_paise),
                pdfINR(g.pending_paise),
                pdfINR(g.advance_paise),
              ]),
            },
            note: 'Not included in the overall figures above.',
          },
        ]
      : []),
    {
      title: 'How to read this',
      note: 'Balance = money left after expenses, counting collections from September 2026 onwards. Yet to collect = billed to flats but not paid yet. Advance = paid by flats beyond what is billed so far.',
    },
  ]);
}

/** PDF + WhatsApp buttons for the society position. */
export function PositionShare({ p, overall }: { p: Pos; overall: Fund[] }) {
  const { t } = useTranslation();
  const m = useMember();
  const [busy, setBusy] = useState(false);
  const pdf = async () => {
    setBusy(true);
    try {
      const blob = await positionPdf(p, overall, m.society_name);
      downloadBlob(`society-position-${istToday()}.pdf`, blob);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const whatsapp = () =>
    window.open(
      `https://wa.me/?text=${encodeURIComponent(positionShareText(p, overall, m.society_name))}`,
      '_blank',
      'noopener',
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" loading={busy} onClick={() => void pdf()}>
        {!busy && <FileDown />} {t('PDF')}
      </Button>
      <Button variant="outline" size="sm" onClick={whatsapp}>
        <MessageCircle /> {t('WhatsApp')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variants: Home (compact card), Reports (tiles), Ledger (strip). Same numbers everywhere.
// ---------------------------------------------------------------------------

/** Home: three headline numbers, top funds on one line each, and share buttons. */
export function SocietyPositionCompact() {
  const { t } = useTranslation();
  const m = useMember();
  const q = usePosition();
  if (!q.data) return null;
  const p = q.data;
  const overall = buildOverall(p, m.isAdmin, t('Earlier months'));
  const tiles = [
    [t('Balance'), p.totals.balance_paise, 'text-credit'],
    [t('Yet to collect'), p.totals.pending_paise, 'text-warning'],
    [t('Advance'), p.totals.advance_paise, 'text-primary'],
  ] as const;
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/reports/position" className="text-[13px] font-semibold text-primary">
            {t('View all')}
          </Link>
        }
      >
        {t('Society position')}
      </SectionTitle>
      <Card className="p-3.5">
        <div className="grid grid-cols-3 gap-2">
          {tiles.map(([label, v, cls]) => (
            <div key={label} className="min-w-0 rounded-xl bg-muted/50 px-2 py-2 text-center">
              <p className="truncate text-[11px] font-semibold text-muted-foreground">{label}</p>
              <p className={`tabular truncate text-[15px] font-extrabold ${cls}`}>{formatINR(v)}</p>
            </div>
          ))}
        </div>
        {overall.length > 0 && (
          <div className="mt-2 divide-y">
            {overall.slice(0, 3).map((f) => (
              <div key={f.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {f.kind === 'general' ? t('General') : f.name}
                </span>
                <span className="shrink-0 text-[12px] text-muted-foreground">{t('to collect')}</span>
                <span className="tabular shrink-0 text-[13px] font-bold text-warning">
                  {formatINR(f.pending_paise)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2.5">
          <PositionShare p={p} overall={overall} />
        </div>
      </Card>
    </section>
  );
}

/** Reports: big tiles plus a link to the full page. */
export function SocietyPositionTiles() {
  const { t } = useTranslation();
  const q = usePosition();
  if (!q.data) return null;
  const p = q.data;
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/reports/position" className="text-[13px] font-semibold text-primary">
            {t('Every fund')}
          </Link>
        }
      >
        {t('Society position')}
      </SectionTitle>
      <Link to="/reports/position" className="grid grid-cols-3 gap-2">
        <StatTile label={t('Balance')} value={formatINR(p.totals.balance_paise)} tone="good" />
        <StatTile label={t('Yet to collect')} value={formatINR(p.totals.pending_paise)} tone="warn" />
        <StatTile label={t('Advance')} value={formatINR(p.totals.advance_paise)} />
      </Link>
      {p.scoped.length > 0 && (
        <p className="mt-1.5 px-1 text-[12px] text-muted-foreground">
          {t('Flat-type-only events (e.g. 3BHK) are kept separate and not included above.')}
        </p>
      )}
    </section>
  );
}

/** Ledger: one slim strip that opens the full page. */
export function SocietyPositionStrip() {
  const { t } = useTranslation();
  const q = usePosition();
  if (!q.data) return null;
  const p = q.data;
  const cells = [
    [t('Balance'), p.totals.balance_paise, 'text-emerald-800 dark:text-emerald-300'],
    [t('To collect'), p.totals.pending_paise, 'text-amber-700 dark:text-amber-300'],
    [t('Advance'), p.totals.advance_paise, 'text-teal-700 dark:text-teal-300'],
  ] as const;
  return (
    <Link
      to="/reports/position"
      className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-lime-50 px-3.5 py-2.5 dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-lime-500/5"
    >
      <div className="grid flex-1 grid-cols-3 gap-2">
        {cells.map(([label, v, cls]) => (
          <div key={label} className="min-w-0">
            <p className="truncate text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className={`tabular truncate text-[14px] font-extrabold ${cls}`}>{formatINR(v)}</p>
          </div>
        ))}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
