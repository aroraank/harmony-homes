import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, ChevronRight, Lock, Slash } from 'lucide-react';
import { toast } from 'sonner';
import { currentPeriod, formatDate, formatINR, periodLabel, periodsBetween } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useSettings } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { StatusChip } from '@/components/StatusChip';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import type { DueRow, UnitStatus } from '@/types';

export default function DuesAdminPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const settings = useSettings(m.societyId);
  const periods = useMemo(() => (settings.data ? periodsBetween(settings.data.start_month, currentPeriod()).reverse() : [currentPeriod()]), [settings.data]);
  const [period, setPeriod] = useState(currentPeriod());
  const [gen, setGen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waive, setWaive] = useState<DueRow | null>(null);
  const [reason, setReason] = useState('');

  const closings = useQuery({
    queryKey: ['closings', m.societyId],
    queryFn: async () => unwrap<{ period: string; closed_at: string; reopened_at: string | null }[]>(await supabase.from('month_closings').select('period, closed_at, reopened_at').eq('society_id', m.societyId).order('closed_at', { ascending: false })),
  });
  const closed = new Set((closings.data ?? []).filter((c) => !c.reopened_at).map((c) => c.period));

  const dues = useQuery({
    queryKey: ['duesAdmin', m.societyId, period],
    queryFn: async () => unwrap<DueRow[]>(await supabase.from('v_dues').select('*').eq('society_id', m.societyId).eq('period', period).eq('due_type', 'monthly').order('unit_code')),
  });

  if (!m.can('generate_dues')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const generate = async () => {
    setBusy(true);
    try {
      const r = await rpc<{ created: number }>('generate_monthly_dues', { p_society: m.societyId, p_period: period });
      toast.success(r.created ? t('{{n}} dues created for {{m}}', { n: r.created, m: periodLabel(period) }) : t('Dues for {{m}} already exist — nothing duplicated', { m: periodLabel(period) }));
      invalidateMoney(qc);
      nudgePush();
      setGen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doWaive = async () => {
    if (!waive) return;
    setBusy(true);
    try {
      await rpc('waive_due', { p_due_id: waive.id, p_reason: reason });
      toast.success(t('Due waived'));
      invalidateMoney(qc);
      setWaive(null);
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const total = (dues.data ?? []).filter((d) => !d.waived).reduce((s, d) => s + d.amount_paise, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Dues & months')} back="/more" />
      <Card className="space-y-3 p-4">
        <Field label={t('Month')}>
          <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodLabel(p)} {closed.has(p) ? `(${t('closed')})` : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-[12.5px] text-muted-foreground">
          {t('Dues are created automatically on the 1st. Generating again never duplicates — it only adds missing flats and uses any advance credit.')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setGen(true)} disabled={closed.has(period)}>
            <CalendarPlus /> {t('Generate dues')}
          </Button>
          <Button asChild variant="outline">
            <Link to={`/reports/month/${period}`}>
              {closed.has(period) ? <Lock /> : null} {t('Month view')}
            </Link>
          </Button>
        </div>
      </Card>

      <SectionTitle>{t('{{m}} dues', { m: periodLabel(period) })}</SectionTitle>
      <QueryState query={dues} empty={(d) => (d.length ? null : <EmptyState title={t('No dues for this month yet')} hint={t('Tap “Generate dues”.')} />)}>
        {(list) => (
          <>
            <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">
              {t('{{n}} flats · expected {{a}}', { n: list.length, a: formatINR(total) })}
            </p>
            <Card className="divide-y">
              {list.map((d) => {
                const st: UnitStatus = d.waived ? 'waived' : d.pending_paise === 0 ? 'paid' : d.paid_paise > 0 ? 'partial' : 'pending';
                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Link to={`/reports/unit/${d.unit_id}`} className="tabular w-16 font-bold">
                      {d.unit_code}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <StatusChip status={st} />
                      {d.waived && d.waived_reason && <p className="truncate text-[11.5px] text-muted-foreground">{d.waived_reason}</p>}
                    </div>
                    <span className="tabular text-sm font-semibold">{formatINR(d.amount_paise)}</span>
                    {st === 'pending' && !closed.has(period) ? (
                      <Button variant="ghost" size="icon-sm" onClick={() => setWaive(d)} aria-label={t('Waive')}>
                        <Slash />
                      </Button>
                    ) : (
                      <span className="w-9" />
                    )}
                  </div>
                );
              })}
            </Card>
          </>
        )}
      </QueryState>

      <SectionTitle>{t('Closed months')}</SectionTitle>
      {(closings.data ?? []).length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">{t('No months closed yet. Close a month from its Month view once the books match the bank.')}</p>
      ) : (
        <Card className="divide-y">
          {(closings.data ?? []).map((c, i) => (
            <Link key={i} to={`/reports/month/${c.period}`} className="flex items-center justify-between px-4 py-3 hover:bg-secondary/50">
              <span className="font-semibold">{periodLabel(c.period)}</span>
              <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                {c.reopened_at ? <Badge variant="warning">{t('Reopened')}</Badge> : <Badge variant="muted">{t('Closed')}</Badge>}
                {formatDate(c.closed_at)}
                <ChevronRight className="size-4" />
              </span>
            </Link>
          ))}
        </Card>
      )}

      <ConfirmSheet
        open={gen}
        onOpenChange={setGen}
        title={t('Generate dues for {{m}}?', { m: periodLabel(period) })}
        description={t('Creates the monthly due for every billable flat that does not have one yet, and notifies members.')}
        confirmLabel={t('Generate dues')}
        loading={busy}
        onConfirm={generate}
      />
      <ConfirmSheet
        open={!!waive}
        onOpenChange={(o) => !o && setWaive(null)}
        title={t('Waive {{u}} for {{m}}?', { u: waive?.unit_code ?? '', m: periodLabel(period) })}
        description={t('The flat will not owe this amount. This is recorded in the audit log.')}
        confirmLabel={t('Waive due')}
        destructive
        loading={busy}
        onConfirm={doWaive}
      >
        <Field label={t('Reason')}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t('e.g. flat vacant, approved in meeting')} />
        </Field>
      </ConfirmSheet>
    </div>
  );
}
