import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Download, FileDown, Filter, ReceiptText, RotateCcw, Search, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { addMonths, currentPeriod, formatDate, formatDateTime, formatINR, periodEnd, periodLabel, periodStart } from '@/lib/format';
import { useMember } from '@/lib/auth';
import { errorMessage, newIdemKey, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useExpenseCategories, useFunds } from '@/lib/queries';
import { categoryLabel, cn, MODE_LABELS } from '@/lib/utils';
import { downloadCsv, rupees } from '@/lib/csv';
import { useOnline } from '@/lib/online';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/States';
import { Money } from '@/components/Money';
import { AttachmentButton } from '@/components/AttachmentButton';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { StatementDialog } from '@/components/StatementDialog';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LedgerRow } from '@/types';

const PAGE = 50;

export default function LedgerPage() {
  const { t } = useTranslation();
  const m = useMember();
  const funds = useFunds(m.societyId);
  const cats = useExpenseCategories(m.societyId);
  const [fund, setFund] = useState('');
  const [dir, setDir] = useState<'' | 'credit' | 'debit'>('');
  const [period, setPeriod] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);

  const periods = useMemo(() => Array.from({ length: 18 }, (_, i) => addMonths(currentPeriod(), -i)), []);

  const buildQuery = () => {
    let q = supabase.from('v_ledger').select('*').eq('society_id', m.societyId);
    if (fund) q = q.eq('fund_id', fund);
    if (dir) q = q.eq('direction', dir);
    if (period) q = q.gte('entry_date', periodStart(period)).lte('entry_date', periodEnd(period));
    const s = search.trim().replace(/[%,()]/g, '');
    if (s) q = q.or(`unit_code.ilike.%${s}%,payee.ilike.%${s}%,reference_no.ilike.%${s}%,receipt_no.ilike.%${s}%,note.ilike.%${s}%`);
    return q.order('entry_date', { ascending: false }).order('created_at', { ascending: false });
  };

  const q = useInfiniteQuery({
    queryKey: ['ledger', m.societyId, fund, dir, period, search],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => unwrap<LedgerRow[]>(await buildQuery().range(pageParam, pageParam + PAGE - 1)),
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  });

  const rows = q.data?.pages.flat() ?? [];
  const byDate = rows.reduce<Record<string, LedgerRow[]>>((acc, r) => {
    (acc[r.entry_date] ??= []).push(r);
    return acc;
  }, {});

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = unwrap<LedgerRow[]>(await buildQuery().range(0, 4999));
      downloadCsv(
        `ledger-${period || 'all'}.csv`,
        ['Date', 'Direction', 'Amount (Rs)', 'Fund', 'Category', 'Flat', 'Payee', 'Mode', 'UTR/Reference', 'Receipt', 'Note', 'Status', 'Recorded by', 'Recorded at'],
        all.map((r) => [
          r.entry_date,
          r.direction,
          rupees(r.amount_paise),
          r.fund_name,
          categoryLabel(r.category, cats.data),
          r.unit_code,
          r.payee,
          MODE_LABELS[r.payment_mode ?? ''] ?? r.payment_mode,
          r.reference_no,
          r.receipt_no,
          r.note,
          r.reverses_entry_id ? 'reversal' : r.is_reversed ? 'reversed' : 'posted',
          r.created_by_name,
          formatDateTime(r.created_at),
        ]),
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const activeFilters = [fund, dir, period].filter(Boolean).length;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Ledger')}
        subtitle={t('Every rupee in and out — entries are never edited or deleted')}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => setStmtOpen(true)} aria-label={t('Download PDF statement')}>
              <FileDown />
            </Button>
            {m.isAdmin && (
              <Button variant="outline" size="icon" onClick={exportCsv} loading={exporting} aria-label={t('Export CSV')}>
                {!exporting && <Download />}
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Flat, payee, UTR, receipt…')} className="pl-10" aria-label={t('Search')} />
        </div>
        <Button variant={activeFilters ? 'default' : 'outline'} size="icon" onClick={() => setShowFilters((v) => !v)} aria-label={t('Filters')} aria-expanded={showFilters}>
          <Filter />
        </Button>
      </div>
      {showFilters && (
        <div className="mb-3 grid grid-cols-1 gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-3">
          <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t('Month')}>
            <option value="">{t('All months')}</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={fund} onChange={(e) => setFund(e.target.value)} aria-label={t('Fund')}>
            <option value="">{t('All funds')}</option>
            {funds.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={dir} onChange={(e) => setDir(e.target.value as '' | 'credit' | 'debit')} aria-label={t('Type')}>
            <option value="">{t('Money in and out')}</option>
            <option value="credit">{t('Money in (credits)')}</option>
            <option value="debit">{t('Money out (debits)')}</option>
          </NativeSelect>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onClick={() => (setFund(''), setDir(''), setPeriod(''))} className="sm:col-span-3">
              <RotateCcw /> {t('Clear filters')}
            </Button>
          )}
        </div>
      )}

      {q.isLoading && !q.data ? (
        <ListSkeleton rows={8} />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ReceiptText className="size-7" />} title={t('No entries')} hint={t('Payments and expenses will show up here.')} />
      ) : (
        <div className="space-y-4">
          {Object.entries(byDate).map(([date, list]) => (
            <section key={date}>
              <h2 className="mb-1.5 px-1 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{formatDate(date)}</h2>
              <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
                {list.map((r, i) => (
                  <EntryRow key={r.id} r={r} cats={cats.data} onClick={() => setSelected(r)} first={i === 0} />
                ))}
              </div>
            </section>
          ))}
          {q.hasNextPage && (
            <Button variant="outline" className="w-full" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
              {t('Load more')}
            </Button>
          )}
        </div>
      )}

      <EntrySheet entry={selected} onClose={() => setSelected(null)} cats={cats.data} />
      <StatementDialog open={stmtOpen} onOpenChange={setStmtOpen} kind="ledger" fundId={fund || undefined} />
    </div>
  );
}

function EntryRow({ r, onClick, first, cats }: { r: LedgerRow; onClick: () => void; first: boolean; cats?: { code: string; label: string }[] }) {
  const { t } = useTranslation();
  const isTransfer = r.category === 'transfer';
  const Icon = isTransfer ? ArrowLeftRight : r.reverses_entry_id ? Undo2 : r.direction === 'credit' ? ArrowDownLeft : ArrowUpRight;
  const title = r.unit_code ? `${r.unit_code} · ${categoryLabel(r.category, cats)}` : r.payee ? `${r.payee}` : categoryLabel(r.category, cats);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/50', !first && 'border-t')}
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl',
          r.direction === 'credit' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
        )}
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[14.5px] font-semibold', r.is_reversed && 'struck')}>{title}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {r.reverses_entry_id ? t('Reversal') + ' · ' : ''}
          {r.payee && r.unit_code ? r.payee + ' · ' : ''}
          {!r.unit_code && r.payee ? categoryLabel(r.category, cats) + ' · ' : ''}
          {r.fund_kind === 'event' ? r.fund_name + ' · ' : ''}
          {MODE_LABELS[r.payment_mode ?? ''] ?? ''}
          {r.reference_no ? ` · ${r.reference_no}` : ''}
        </p>
      </div>
      <div className="text-right">
        <Money paise={r.signed_paise} sign tone="auto" className={cn('text-[15px] font-bold', r.is_reversed && 'struck')} />
        {r.is_reversed && <p className="text-[10.5px] font-bold uppercase text-destructive">{t('Reversed')}</p>}
      </div>
    </button>
  );
}

function EntrySheet({ entry, onClose, cats }: { entry: LedgerRow | null; onClose: () => void; cats?: { code: string; label: string }[] }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const online = useOnline();
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [idem] = useState(() => newIdemKey('rev'));
  const reverse = useMutation({
    mutationFn: () => rpc('reverse_entry', { p_entry_id: entry!.id, p_reason: reason, p_idempotency_key: `${idem}-${entry!.id}` }),
    onSuccess: () => {
      toast.success(t('Entry reversed. Record the correct entry if needed.'));
      invalidateMoney(qc);
      setConfirm(false);
      setReason('');
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!entry) return null;
  const e = entry;
  const canReverse = m.can('reverse_entry') && !e.reverses_entry_id && !e.is_reversed && online;
  const rows: [string, React.ReactNode][] = [
    [t('Date'), formatDate(e.entry_date)],
    [t('Fund'), e.fund_name],
    [t('Category'), categoryLabel(e.category, cats)],
    [t('Flat'), e.unit_code],
    [t('Payee'), e.payee],
    [t('Mode'), MODE_LABELS[e.payment_mode ?? ''] ?? e.payment_mode],
    [t('UTR / reference'), e.reference_no],
    [t('Receipt'), e.receipt_no],
    [t('Note'), e.note],
    [t('Backdated because'), e.backdate_reason],
    [t('Recorded by'), e.created_by_name],
    [t('Recorded at'), formatDateTime(e.created_at)],
  ];
  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Money paise={e.signed_paise} sign tone="auto" className={cn('text-2xl font-extrabold', e.is_reversed && 'struck')} />
            {e.reverses_entry_id && <Badge variant="info">{t('Reversal')}</Badge>}
            {e.is_reversed && <Badge variant="danger">{t('Reversed')}</Badge>}
          </DialogTitle>
        </DialogHeader>
        {e.is_reversed && e.reversal_note && (
          <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:bg-rose-500/10 dark:text-rose-200">{e.reversal_note}</p>
        )}
        <dl className="divide-y rounded-2xl border text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words text-right font-medium">{v}</dd>
              </div>
            ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {e.attachment_path && <AttachmentButton path={e.attachment_path} />}
          {e.receipt_no && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/receipts/${e.id}`} onClick={onClose}>
                <ReceiptText /> {t('Receipt')}
              </Link>
            </Button>
          )}
        </div>
        {canReverse && (
          <div className="mt-5 rounded-2xl border border-destructive/30 p-3.5">
            <p className="text-sm font-semibold">{t('Made a mistake?')}</p>
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              {t('Entries cannot be edited. Reverse it with a reason, then record the correct entry.')}
              {e.transfer_group ? ' ' + t('Both sides of this transfer will be reversed.') : ''}
            </p>
            <Field label={t('Reason')} hint={t('Visible in the ledger and audit log')}>
              <Textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={300} placeholder={t('e.g. typo in amount')} />
            </Field>
            <Button variant="destructive" className="mt-3 w-full" disabled={reason.trim().length < 5} onClick={() => setConfirm(true)}>
              <Undo2 /> {t('Reverse entry')}
            </Button>
          </div>
        )}
        <ConfirmSheet
          open={confirm}
          onOpenChange={setConfirm}
          title={t('Reverse this entry?')}
          description={t('A matching opposite entry will be added. This cannot be undone.')}
          rows={[
            { label: t('Amount'), value: formatINR(e.amount_paise), strong: true },
            { label: t('Date'), value: formatDate(e.entry_date) },
            { label: t('Reason'), value: reason },
          ]}
          confirmLabel={t('Reverse entry')}
          destructive
          loading={reverse.isPending}
          onConfirm={() => reverse.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}
