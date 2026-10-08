import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Lock, LockOpen, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { addMonths, currentPeriod, formatDate, formatINR, isValidPeriod, periodLabel, periodsBetween } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { invalidateMoney, useExpenseCategories, useSettings } from '@/lib/queries';
import { downloadCsv, rupees } from '@/lib/csv';
import { pdfINR, reportPdf, shareOrDownloadPdf } from '@/lib/pdf';
import { categoryLabel, MODE_LABELS, shareText } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { MonthChips } from '@/components/MonthChips';
import { CardSkeleton, ErrorState } from '@/components/States';
import { StatusChip } from '@/components/StatusChip';
import { UnitLink } from '@/components/UnitLink';
import { Money } from '@/components/Money';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { MonthReport } from '@/types';

export default function MonthReportPage() {
  const { t } = useTranslation();
  const { period: raw } = useParams();
  const nav = useNavigate();
  const m = useMember();
  const qc = useQueryClient();
  const settings = useSettings(m.societyId);
  const cats = useExpenseCategories(m.societyId);
  const period = raw && isValidPeriod(raw) ? raw : currentPeriod();
  const monthlyOn = settings.data?.monthly_dues_enabled !== false;
  const [scopeSel, setScope] = useState<'general' | 'all' | null>(null);
  const scope: 'general' | 'all' = scopeSel ?? (monthlyOn ? 'general' : 'all');
  const [action, setAction] = useState<null | 'close' | 'reopen'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const periods = useMemo(() => {
    const start = settings.data?.start_month ?? addMonths(currentPeriod(), -11);
    const from = start < addMonths(currentPeriod(), -35) ? addMonths(currentPeriod(), -35) : addMonths(start, -1);
    return periodsBetween(from, currentPeriod());
  }, [settings.data]);

  const fundsQ = useQuery({
    queryKey: ['monthReport', m.societyId, period, scope],
    queryFn: async () => {
      const general = scope === 'general' ? await rpc<string>('general_fund_id', { p_society: m.societyId }) : null;
      return rpc<MonthReport>('month_report', { p_society: m.societyId, p_period: period, p_fund_id: general });
    },
  });
  const r = fundsQ.data;

  const runAction = async () => {
    setBusy(true);
    try {
      if (action === 'close') await rpc('close_month', { p_society: m.societyId, p_period: period });
      else await rpc('reopen_month', { p_society: m.societyId, p_period: period, p_reason: reason });
      toast.success(action === 'close' ? t('{{m}} closed', { m: periodLabel(period) }) : t('{{m}} reopened', { m: periodLabel(period) }));
      invalidateMoney(qc);
      setAction(null);
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pendingUnits = (r?.units ?? []).filter((u) => u.status === 'pending' || u.status === 'partial').sort((a, b) => b.pending_paise - a.pending_paise);
  const paidUnits = (r?.units ?? []).filter((u) => u.status === 'paid' || u.status === 'advance');

  const sharePending = () => {
    if (!r) return;
    const lines = pendingUnits.map((u) => `• ${u.unit_code}: ${formatINR(u.pending_paise)}${u.status === 'partial' ? ' (part paid)' : ''}`);
    void shareText(
      `${m.society_name}\nMaintenance pending for ${periodLabel(period)}\n\n${lines.join('\n') || 'None 🎉'}\n\nTotal pending: ${formatINR(r.pending_paise)}\nPlease pay via the Harmony Homes app.`,
    );
  };

  const exportCsv = () => {
    if (!r) return;
    downloadCsv(
      `month-${period}.csv`,
      ['Flat', 'Status', 'Due (Rs)', 'Paid towards this month (Rs)', 'Pending (Rs)', 'Advance held (Rs)', 'Receipt nos (received this month)'],
      r.units.map((u) => [u.unit_code, u.status, rupees(u.due_paise), rupees(u.paid_paise), rupees(u.pending_paise), rupees(u.advance_paise), r.payments.filter((p) => p.unit_code === u.unit_code).map((p) => p.receipt_no).filter(Boolean).join('; ')]),
    );
  };

  const exportPdf = async () => {
    if (!r) return;
    try {
      const blob = await reportPdf(`Month report — ${periodLabel(period)}`, m.society_name, [
        {
          title: scope === 'general' ? 'Summary (General fund)' : 'Summary (all funds)',
          summary: [
            ['Opening balance', pdfINR(r.opening_paise)],
            ['Expected maintenance', pdfINR(r.expected_paise)],
            ['Maintenance collected (dated this month)', pdfINR(r.maintenance_collected_paise)],
            ['Collected from earlier advances', pdfINR(r.collected_from_advances_paise)],
            ...(r.event_collected_paise ? [['Event contributions', pdfINR(r.event_collected_paise)] as [string, string]] : []),
            ...(r.other_income_paise ? [['Other income / adjustments', pdfINR(r.other_income_paise)] as [string, string]] : []),
            ...(r.transfers_net_paise ? [['Transfers between funds (net)', pdfINR(r.transfers_net_paise)] as [string, string]] : []),
            ['Spent', pdfINR(r.spent_paise)],
            [r.net_paise >= 0 ? 'Surplus' : 'Shortfall', pdfINR(Math.abs(r.net_paise))],
            ['Closing balance', pdfINR(r.closing_paise)],
          ],
          note: r.shortfall_paise > 0 ? `Shortfall of ${pdfINR(r.shortfall_paise)} covered from previous balance.` : undefined,
        },
        { title: 'Spent by category', table: { head: ['Category', 'Amount'], body: r.spent_by_category.map((c) => [c.label, pdfINR(c.amount_paise)]) } },
        {
          title: 'Payments received',
          table: { head: ['Date', 'Flat', 'Amount', 'Mode', 'Receipt'], body: r.payments.map((p) => [formatDate(p.date), p.unit_code, pdfINR(p.amount_paise), MODE_LABELS[p.mode] ?? p.mode, p.receipt_no]) },
        },
        { title: 'Pending / partial', table: { head: ['Flat', 'Due', 'Paid', 'Pending'], body: pendingUnits.map((u) => [u.unit_code, pdfINR(u.due_paise), pdfINR(u.paid_paise), pdfINR(u.pending_paise)]) } },
        { title: 'Paid extra', table: { head: ['Flat', 'Extra'], body: r.extra_payers.map((x) => [x.unit_code, pdfINR(x.extra_paise)]) } },
        {
          title: 'Expenses',
          table: { head: ['Date', 'Payee', 'Category', 'Amount'], body: r.expenses.map((x) => [formatDate(x.date), x.payee ?? '', categoryLabel(x.category, cats.data), pdfINR(x.amount_paise)]) },
        },
      ]);
      await shareOrDownloadPdf(blob, `month-${period}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Month view')} subtitle={m.society_name} back="/reports" />
      <MonthChips periods={periods} value={period} onChange={(p) => nav(`/reports/month/${p}`, { replace: true })} />
      <div className="mt-3 flex items-center gap-2">
        <Tabs value={scope} onValueChange={(v) => setScope(v as 'general' | 'all')} className="flex-1">
          <TabsList>
            {monthlyOn && <TabsTrigger value="general">{t('Maintenance (General)')}</TabsTrigger>}
            <TabsTrigger value="all">{t('All funds')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {fundsQ.isLoading && !r ? (
        <CardSkeleton className="mt-3 h-96" />
      ) : !r ? (
        <ErrorState error={fundsQ.error} onRetry={() => fundsQ.refetch()} />
      ) : (
        <>
          <Card className="mt-3 overflow-hidden">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="font-bold">{periodLabel(period, true)}</p>
              {r.is_closed ? (
                <Badge variant="muted">
                  <Lock className="size-3.5" /> {t('Closed')}
                </Badge>
              ) : (
                <Badge variant="success">{t('Open')}</Badge>
              )}
            </div>
            <dl className="divide-y text-[14px]">
              <Line label={t('Opening balance')} value={r.opening_paise} />
              {r.expected_paise > 0 && <Line label={t('Expected collection')} value={r.expected_paise} muted />}
              <Line label={t('Collected (maintenance)')} value={r.maintenance_collected_paise} tone="credit" sign />
              {r.collected_from_advances_paise > 0 && <Line label={t('Settled from earlier advances')} value={r.collected_from_advances_paise} muted />}
              {r.event_collected_paise !== 0 && <Line label={t('Event contributions')} value={r.event_collected_paise} tone="credit" sign />}
              {r.other_income_paise !== 0 && <Line label={t('Other income / adjustments')} value={r.other_income_paise} sign tone="auto" />}
              {r.transfers_net_paise !== 0 && <Line label={t('Transfers between funds')} value={r.transfers_net_paise} sign tone="auto" />}
              <Line label={t('Spent')} value={-r.spent_paise} tone="debit" sign />
              <Line label={r.net_paise >= 0 ? t('Surplus') : t('Shortfall')} value={r.net_paise} sign tone="auto" strong />
              <Line label={t('Closing balance')} value={r.closing_paise} strong />
            </dl>
            {r.shortfall_paise > 0 && (
              <div className="border-t bg-amber-50 px-4 py-3 text-[13.5px] font-semibold text-amber-950 dark:bg-amber-500/10 dark:text-amber-100">
                <p>
                  {r.opening_paise >= r.shortfall_paise
                    ? t('Shortfall of {{a}} covered from previous balance.', { a: formatINR(r.shortfall_paise) })
                    : t('Shortfall of {{a}} — more than the previous balance, so the fund went negative.', { a: formatINR(r.shortfall_paise) })}
                </p>
                {pendingUnits.length > 0 && (
                  <a href="#flats" className="mt-1 inline-block underline underline-offset-2">
                    {t('See who still owes, highest first →')}
                  </a>
                )}
              </div>
            )}
            {r.expected_paise > 0 && (
              <p className="border-t px-4 py-2.5 text-[12.5px] text-muted-foreground">
                {t('Still pending for this month')}: <strong className="text-debit">{formatINR(r.pending_paise)}</strong>
              </p>
            )}
          </Card>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button variant="outline" size="sm" onClick={exportPdf}>
              <FileText /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={sharePending}>
              <Share2 /> {t('Pending')}
            </Button>
          </div>
          {m.can('reopen_month') && r.is_closed && (
            <Button variant="outline" className="mt-2 w-full" onClick={() => setAction('reopen')}>
              <LockOpen /> {t('Reopen {{m}}', { m: periodLabel(period) })}
            </Button>
          )}

          {r.spent_by_category.length > 0 && (
            <>
              <SectionTitle>{t('Spent by category')}</SectionTitle>
              <Card className="divide-y">
                {r.spent_by_category.map((c) => (
                  <div key={c.category} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="font-medium">{t(c.label)}</span>
                    <Money paise={c.amount_paise} className="font-bold" />
                  </div>
                ))}
              </Card>
            </>
          )}

          {r.units.length > 0 && (
            <div id="flats">
              <SectionTitle>{t('Flats')}</SectionTitle>
              <p className="-mt-1 mb-2 px-1 text-[12px] text-muted-foreground">{t('Unpaid flats are listed highest amount owed first.')}</p>
              <Tabs defaultValue="pending">
                <TabsList>
                  <TabsTrigger value="pending">
                    {t('Unpaid / partial')} ({pendingUnits.length})
                  </TabsTrigger>
                  <TabsTrigger value="paid">
                    {t('Paid')} ({paidUnits.length})
                  </TabsTrigger>
                  <TabsTrigger value="extra">
                    {t('Paid extra')} ({r.extra_payers.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="pending">
                  <UnitGrid units={pendingUnits} show="pending" />
                </TabsContent>
                <TabsContent value="paid">
                  <UnitGrid units={paidUnits} show="paid" />
                </TabsContent>
                <TabsContent value="extra">
                  {r.extra_payers.length === 0 ? (
                    <p className="p-4 text-center text-sm text-muted-foreground">{t('Nobody paid extra this month.')}</p>
                  ) : (
                    <Card className="divide-y">
                      {r.extra_payers.map((x) => (
                        <UnitLink key={x.unit_id} unitId={x.unit_id} className="flex items-center justify-between px-4 py-3 hover:bg-secondary/50">
                          <span className="tabular font-semibold">{x.unit_code}</span>
                          <span className="text-sm">
                            {t('paid extra')} <Money paise={x.extra_paise} className="font-bold text-credit" />
                          </span>
                        </UnitLink>
                      ))}
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {r.payments.length > 0 && (
            <>
              <SectionTitle>{t('Payments received')}</SectionTitle>
              <Card className="divide-y">
                {r.payments.map((p) => (
                  <Link key={p.entry_id} to={`/receipts/${p.entry_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                    <span className="tabular w-16 font-semibold">{p.unit_code}</span>
                    <span className="flex-1 truncate text-[12.5px] text-muted-foreground">
                      {formatDate(p.date)} · {MODE_LABELS[p.mode] ?? p.mode}
                      {p.category === 'event_contribution' ? ` · ${p.fund}` : ''}
                    </span>
                    <Money paise={p.amount_paise} className="font-bold text-credit" />
                  </Link>
                ))}
              </Card>
            </>
          )}

          {r.expenses.length > 0 && (
            <>
              <SectionTitle>{t('Expenses')}</SectionTitle>
              <Card className="divide-y">
                {r.expenses.map((x) => (
                  <div key={x.entry_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{x.payee || categoryLabel(x.category, cats.data)}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {formatDate(x.date)} · {categoryLabel(x.category, cats.data)}
                      </p>
                    </div>
                    <Money paise={-x.amount_paise} sign tone="debit" className="font-bold" />
                  </div>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      <ConfirmSheet
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action === 'close' ? t('Close {{m}}?', { m: periodLabel(period) }) : t('Reopen {{m}}?', { m: periodLabel(period) })}
        description={
          action === 'close'
            ? t('A snapshot is saved and nothing dated in this month can be added or reversed until the super admin reopens it.')
            : t('Reopening is recorded in the audit log.')
        }
        confirmLabel={action === 'close' ? t('Close month') : t('Reopen month')}
        loading={busy}
        onConfirm={runAction}
      >
        {action === 'reopen' && (
          <Field label={t('Reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
        )}
      </ConfirmSheet>
    </div>
  );
}

function Line({ label, value, sign, tone, strong, muted }: { label: string; value: number; sign?: boolean; tone?: 'credit' | 'debit' | 'auto'; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${strong ? 'bg-muted/40' : ''}`}>
      <dt className={muted ? 'text-muted-foreground' : strong ? 'font-bold' : ''}>{label}</dt>
      <dd>
        <Money paise={value} sign={sign} tone={tone} className={strong ? 'text-base font-extrabold' : muted ? 'text-muted-foreground' : 'font-semibold'} />
      </dd>
    </div>
  );
}

function UnitGrid({ units, show }: { units: MonthReport['units']; show: 'pending' | 'paid' }) {
  const { t } = useTranslation();
  if (!units.length) return <p className="p-4 text-center text-sm text-muted-foreground">{show === 'pending' ? t('Everyone has paid 🎉') : t('No payments yet.')}</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {units.map((u) => (
        <UnitLink key={u.unit_id} unitId={u.unit_id} className="rounded-2xl border bg-card p-3 shadow-card hover:bg-secondary/50">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="tabular whitespace-nowrap font-bold">{u.unit_code}</span>
            <StatusChip status={u.status} />
          </div>
          <p className="tabular mt-1.5 text-[12.5px] text-muted-foreground">
            {show === 'pending' ? (
              <>
                <strong className="text-debit">{formatINR(u.pending_paise)}</strong> {t('pending')}
              </>
            ) : (
              <>
                {formatINR(u.paid_paise)}
                {u.advance_paise > 0 && <span className="text-credit"> · +{formatINR(u.advance_paise)}</span>}
              </>
            )}
          </p>
        </UnitLink>
      ))}
    </div>
  );
}
