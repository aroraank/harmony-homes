import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FileDown, FileText, IndianRupee, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatINR, istToday } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useUnits } from '@/lib/queries';
import { downloadCsv, rupees } from '@/lib/csv';
import { pdfINR, reportPdf, shareOrDownloadPdf } from '@/lib/pdf';
import { cn, MODE_LABELS, shareText } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { UnitSelect } from '@/components/UnitSelect';
import { StatTile } from '@/components/StatTile';
import { StatusChip } from '@/components/StatusChip';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatementDialog } from '@/components/StatementDialog';
import type { UnitStatement, UnitStatus } from '@/types';

export default function UnitStatementPage() {
  const { t } = useTranslation();
  const { unitId } = useParams();
  const nav = useNavigate();
  const m = useMember();
  const units = useUnits(m.societyId);
  const q = useQuery({
    queryKey: ['unitStatement', unitId],
    enabled: !!unitId,
    queryFn: () => rpc<UnitStatement>('unit_statement', { p_unit_id: unitId }),
  });
  const s = q.data;
  const [stmtOpen, setStmtOpen] = useState(false);
  // members only see their own flat; send them there
  useEffect(() => {
    if (!m.isAdmin && m.unit_id && unitId !== m.unit_id) nav(`/reports/unit/${m.unit_id}`, { replace: true });
  }, [m.isAdmin, m.unit_id, unitId, nav]);

  const exportCsv = () => {
    if (!s) return;
    downloadCsv(
      `statement-${s.unit.code}.csv`,
      ['Flat', 'Type', 'Date', 'Description', 'Amount (Rs)', 'Paid (Rs)', 'Pending (Rs)', 'Status', 'Receipt no'],
      [
        ...s.dues.map((d) => [s.unit.code, 'Due', d.due_date, d.label, rupees(d.amount_paise), rupees(d.paid_paise), rupees(d.pending_paise), d.waived ? 'waived' : d.pending_paise ? 'pending' : 'paid', '']),
        ...s.payments.map((p) => [s.unit.code, 'Payment', p.date, `${p.fund} ${MODE_LABELS[p.mode] ?? p.mode} ${p.reference_no ?? ''}`.trim(), rupees(p.amount_paise), '', '', p.is_reversed ? 'cancelled' : 'received', p.receipt_no ?? '']),
      ],
    );
  };
  const exportPdf = async () => {
    if (!s) return;
    try {
      const blob = await reportPdf(`Statement — ${s.unit.code}`, m.society_name, [
        {
          title: `${s.unit.code} · ${s.unit.display_name} (${s.unit.type})`,
          summary: [
            ['Total paid', pdfINR(s.totals.paid_paise)],
            ['Pending', pdfINR(s.totals.pending_paise)],
            ['Overdue', pdfINR(s.totals.overdue_paise)],
            ['Advance held', pdfINR(s.totals.advance_paise)],
          ],
        },
        {
          title: 'Dues',
          table: { head: ['Due date', 'For', 'Amount', 'Paid', 'Pending'], body: s.dues.map((d) => [formatDate(d.due_date), d.label + (d.waived ? ' (waived)' : ''), pdfINR(d.amount_paise), pdfINR(d.paid_paise), pdfINR(d.pending_paise)]) },
        },
        {
          title: 'Payments',
          table: { head: ['Date', 'Receipt', 'Mode', 'Amount', 'Towards'], body: s.payments.map((p) => [formatDate(p.date), (p.receipt_no ?? '') + (p.is_reversed ? ' CANCELLED' : ''), MODE_LABELS[p.mode] ?? p.mode, pdfINR(p.amount_paise), p.allocations.map((a) => a.label).join(', ')]) },
        },
      ]);
      await shareOrDownloadPdf(blob, `statement-${s.unit.code}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const share = () => {
    if (!s) return;
    const pending = s.dues.filter((d) => d.pending_paise > 0).map((d) => `• ${d.label}: ${formatINR(d.pending_paise)}`);
    void shareText(
      `${m.society_name} — ${s.unit.code}\nPaid so far: ${formatINR(s.totals.paid_paise)}\nPending: ${formatINR(s.totals.pending_paise)}${pending.length ? '\n' + pending.join('\n') : ''}${s.totals.advance_paise ? `\nAdvance: ${formatINR(s.totals.advance_paise)}` : ''}`,
    );
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Flat statement')} back="/reports" />
      {m.isAdmin && <UnitSelect units={units.data ?? []} value={unitId ?? ''} onChange={(e) => e.target.value && nav(`/reports/unit/${e.target.value}`, { replace: true })} aria-label={t('Flat')} />}
      {!unitId ? (
        <EmptyState title={t('Choose a flat to see its statement')} />
      ) : q.isLoading ? (
        <CardSkeleton className="mt-3 h-80" />
      ) : !s ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            <strong className="text-foreground">{s.unit.display_name}</strong> · {s.unit.type} · {t(s.unit.status === 'vacant' ? 'Vacant' : 'Occupied')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <StatTile label={t('Pending')} value={formatINR(s.totals.pending_paise)} tone={s.totals.pending_paise ? 'bad' : 'good'} hint={s.totals.overdue_paise ? t('{{a}} overdue', { a: formatINR(s.totals.overdue_paise) }) : undefined} />
            <StatTile label={t('Advance held')} value={formatINR(s.totals.advance_paise + s.totals.event_advance_paise)} tone="good" />
            <StatTile label={t('Total paid')} value={formatINR(s.totals.paid_paise)} className="col-span-2" />
          </div>
          <Button className="mt-3 w-full" variant="secondary" onClick={() => setStmtOpen(true)}>
            <FileDown /> {t('Download statement (PDF) for a period')}
          </Button>
          <StatementDialog open={stmtOpen} onOpenChange={setStmtOpen} kind="flat" unitId={s.unit.id} />
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileText /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={share}>
              <Share2 /> {t('Share')}
            </Button>
          </div>
          {m.can('record_payment') && (
            <Button asChild className="mt-2 w-full">
              <Link to={`/admin/payment?unit=${s.unit.id}`}>
                <IndianRupee /> {t('Record payment for {{u}}', { u: s.unit.code })}
              </Link>
            </Button>
          )}

          <SectionTitle>{t('Dues')}</SectionTitle>
          {s.dues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No dues yet')}</p>
          ) : (
            <Card className="divide-y">
              {s.dues.map((d) => {
                const st: UnitStatus = d.waived ? 'waived' : d.pending_paise === 0 ? 'paid' : d.paid_paise > 0 ? 'partial' : 'pending';
                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{d.label}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {t('due')} {formatDate(d.due_date)}
                        {d.waived && d.waived_reason ? ` · ${d.waived_reason}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money paise={d.amount_paise} className="text-sm font-bold" />
                      <div className="mt-0.5">
                        {st === 'pending' && d.due_date > istToday() ? (
                          <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{t('Not due yet')}</span>
                        ) : (
                          <StatusChip status={st} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <SectionTitle>{t('Payments')}</SectionTitle>
          {s.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No payments yet')}</p>
          ) : (
            <Card className="divide-y">
              {s.payments.map((p) => (
                <Link key={p.entry_id} to={`/receipts/${p.entry_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-semibold', p.is_reversed && 'struck')}>{p.receipt_no ?? MODE_LABELS[p.mode]}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {formatDate(p.date)} · {MODE_LABELS[p.mode] ?? p.mode}
                      {p.allocations.length ? ` · ${p.allocations.map((a) => a.label).join(', ')}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <Money paise={p.amount_paise} className={cn('font-bold text-credit', p.is_reversed && 'struck')} />
                    {p.is_reversed && <p className="text-[10.5px] font-bold uppercase text-destructive">{t('Cancelled')}</p>}
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
