import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, istToday } from '@harmony/shared';
import { addMonths, currentPeriod, periodLabel } from '@/lib/format';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useExpenseCategories } from '@/lib/queries';
import { statementPdf, type StatementLine } from '@/lib/pdf';
import { downloadBlob } from '@/lib/csv';
import { RANGE_OPTIONS, resolveRange, validateRange, type RangeKey } from '@/lib/statementRange';
import { categoryLabel, MODE_LABELS, unitLabel } from '@/lib/utils';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type LedgerRowS = {
  date: string;
  direction: 'credit' | 'debit';
  amount_paise: number;
  fund: string;
  category: string;
  unit_code: string | null;
  payee: string | null;
  mode: string | null;
  reference_no: string | null;
  receipt_no: string | null;
  note: string | null;
  is_reversed: boolean;
  is_reversal: boolean;
  is_catchup: boolean;
  for_label: string | null;
};
type LedgerStatement = {
  from: string;
  to: string;
  opening_paise: number;
  rows: LedgerRowS[];
  fund: string | null;
  society: string;
};
type FlatStatement = {
  from: string;
  to: string;
  opening_paise: number;
  society: string;
  unit: { code: string; display_name: string };
  rows: {
    date: string;
    kind: string;
    description: string;
    reference: string | null;
    debit_paise: number;
    credit_paise: number;
    is_catchup: boolean;
    for_label: string | null;
  }[];
};

/** Pick a period (last month … everything, or custom dates) and download a PDF statement. */
export function StatementDialog({
  open,
  onOpenChange,
  kind,
  unitId,
  fundId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: 'ledger' | 'flat';
  unitId?: string;
  fundId?: string;
}) {
  const { t } = useTranslation();
  const m = useMember();
  const cats = useExpenseCategories(m.societyId);
  const today = istToday();
  const [key, setKey] = useState<RangeKey>('this_month');
  const [month, setMonth] = useState(addMonths(currentPeriod(), -1));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const range = resolveRange(key, { from, to, month });
  const problem = key === 'custom' ? (from ? validateRange(range) : 'Choose both dates.') : null;

  const run = async () => {
    setErr(null);
    if (problem) return setErr(t(problem));
    setBusy(true);
    try {
      let blob: Blob;
      let name: string;
      if (kind === 'ledger') {
        const s = await rpc<LedgerStatement>('ledger_statement', {
          p_society: m.societyId,
          p_from: range.from,
          p_to: range.to,
          p_fund_id: fundId || null,
        });
        const lines: StatementLine[] = s.rows
          .filter((r) => !r.is_reversed && !r.is_reversal)
          .map((r) => {
            const isEventFund = r.category === 'event_contribution';
            const description =
              [
                // For an event contribution the fund name already says what it's for
                // (e.g. "Security guard salary – September 2026"), so a generic
                // "Event contribution" label would only repeat without adding anything.
                isEventFund ? r.fund : categoryLabel(r.category, cats.data),
                isEventFund ? null : r.fund,
                r.payee ? t('Paid to {{p}}', { p: r.payee }) : null,
                r.mode ? (MODE_LABELS[r.mode] ?? r.mode) : null,
                r.reference_no ? `UTR ${r.reference_no}` : null,
                r.note,
                r.is_catchup ? t('Catch-up payment — for {{p}}', { p: r.for_label }) : null,
              ]
                .filter(Boolean)
                .join(' · ') +
              (r.is_reversed ? ' [CANCELLED]' : '') +
              (r.is_reversal ? ' [REVERSAL]' : '');
            return {
              date: r.date,
              flat: unitLabel(r.unit_code) || (r.unit_code ?? ''),
              description,
              ref: r.receipt_no ?? '',
              a: r.direction === 'credit' ? r.amount_paise : 0,
              b: r.direction === 'debit' ? r.amount_paise : 0,
              delta: r.direction === 'credit' ? r.amount_paise : -r.amount_paise,
              highlight: r.is_catchup,
            };
          });
        blob = await statementPdf({
          title: 'LEDGER STATEMENT',
          societyName: s.society,
          subject: `${s.society} — ${s.fund ?? 'All funds'}`,
          from: s.from,
          to: s.to,
          headA: 'Money in',
          headB: 'Money out',
          opening: s.opening_paise,
          lines,
          balanceMode: 'cash',
          note: 'Balance = money in less money out.',
        });
        name = `ledger-${s.from}-to-${s.to}.pdf`;
        void rpc('log_statement_export', {
          p_society: m.societyId,
          p_kind: 'ledger',
          p_unit: null,
          p_from: s.from,
          p_to: s.to,
        }).catch(() => undefined);
      } else {
        const s = await rpc<FlatStatement>('unit_ledger_statement', {
          p_unit_id: unitId,
          p_from: range.from,
          p_to: range.to,
        });
        const lines: StatementLine[] = s.rows.map((r) => ({
          date: r.date,
          description: r.description,
          ref: r.reference ?? '',
          a: r.debit_paise,
          b: r.credit_paise,
          delta: r.debit_paise - r.credit_paise,
          highlight: r.is_catchup,
        }));
        blob = await statementPdf({
          title: 'FLAT STATEMENT',
          societyName: s.society,
          subject: `${s.unit.code} · ${s.unit.display_name}`,
          from: s.from,
          to: s.to,
          headA: 'Charges',
          headB: 'Paid / credited',
          opening: s.opening_paise,
          lines,
          balanceMode: 'owed',
          note: 'Dr = amount the flat still owes. Cr = amount paid in advance (surplus) that will be adjusted against future dues.',
        });
        name = `statement-${s.unit.code}-${s.from}-to-${s.to}.pdf`;
        void rpc('log_statement_export', {
          p_society: m.societyId,
          p_kind: 'flat',
          p_unit: unitId,
          p_from: s.from,
          p_to: s.to,
        }).catch(() => undefined);
      }
      downloadBlob(name, blob);
      toast.success(t('Statement downloaded'));
      onOpenChange(false);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === 'ledger' ? t('Download ledger statement') : t('Download flat statement')}
          </DialogTitle>
          <DialogDescription>
            {t('A PDF with the opening balance, every entry, a running balance and the closing balance.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Period')}>
            <NativeSelect value={key} onChange={(e) => setKey(e.target.value as RangeKey)}>
              {RANGE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {t(o.label)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {key === 'month' && (
            <Field label={t('Month')}>
              <NativeSelect value={month} onChange={(e) => setMonth(e.target.value)}>
                {Array.from({ length: 18 }, (_, i) => addMonths(currentPeriod(), -i)).map((p) => (
                  <option key={p} value={p}>
                    {periodLabel(p)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {key === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('From')}>
                <Input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label={t('To')}>
                <Input
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}
          <p className="rounded-xl bg-secondary px-3 py-2 text-[13px]">
            {range.from ? formatDate(range.from) : t('First entry')} → {range.to ? formatDate(range.to) : ''}
          </p>
          {err && <Alert variant="danger">{err}</Alert>}
          <Button size="lg" className="w-full" loading={busy} onClick={() => void run()}>
            <FileDown /> {t('Download PDF')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
