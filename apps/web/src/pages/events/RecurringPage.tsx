import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronRight, Pencil, Plus, Repeat, Send, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { currentPeriod, formatDate, formatINR, parseRupeesToPaise, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { invalidateMoney, useUnitTypes } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { AmountInput } from '@/components/AmountInput';
import { IntInput } from '@/components/IntInput';
import { ChangeAmountDialog, type AmountMode } from '@/components/ChangeAmountDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Hist = { amount_paise: number; from: string; reason: string | null; at: string };
type Series = {
  id: string; title: string; description: string | null; scope_type: 'all' | 'unit_types'; due_day: number; is_active: boolean;
  total_cost_paise: number; pending_total_paise: number | null; pending_from_period: string | null; this_month_event_id: string | null; history: Hist[];
};
type Expense = {
  id: string; title: string; day_of_month: number; is_active: boolean; amount_paise: number;
  pending_amount_paise: number | null; pending_from_period: string | null; history: Hist[];
};
type Overview = { series: Series[]; expenses: Expense[] };

function nextPeriodOf(p: string) {
  const y = Number(p.slice(0, 4));
  const mo = Number(p.slice(5, 7));
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

function History({ rows }: { rows: Hist[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer font-semibold text-primary">{t('History ({{n}})', { n: rows.length })}</summary>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((h, i) => (
          <li key={i} className="rounded-lg bg-secondary/60 px-3 py-2">
            <span className="tabular font-bold">{formatINR(h.amount_paise)}</span>{' '}
            <span className="text-muted-foreground">
              · {t('from {{m}}', { m: periodLabel(h.from) })} · {formatDate(h.at.slice(0, 10))}
              {h.reason ? ` · ${h.reason}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function RecurringPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const types = useUnitTypes(m.societyId);
  const cur = currentPeriod();
  const next = nextPeriodOf(cur);
  const canEvents = m.can('manage_events');
  const canExp = m.can('record_expense');

  const q = useQuery({ queryKey: ['recurring', m.societyId], queryFn: () => rpc<Overview>('recurring_overview', { p_society: m.societyId }) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['recurring'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['templates'] });
    void qc.invalidateQueries({ queryKey: ['eventsOverview'] });
    invalidateMoney(qc);
    nudgePush();
  };

  const [change, setChange] = useState<{ kind: 'series' | 'expense'; id: string; title: string; paise: number } | null>(null);
  const [edit, setEdit] = useState<Series | null>(null);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const submitChange = async (paise: number, mode: AmountMode, reason: string) => {
    if (!change) return;
    if (change.kind === 'series') await rpc('change_series_amount', { p_series: change.id, p_total_cost_paise: paise, p_mode: mode, p_reason: reason });
    else await rpc('change_template_amount', { p_template: change.id, p_amount_paise: paise, p_mode: mode, p_reason: reason });
    toast.success(t('Saved. Everyone has been notified.'));
    refresh();
  };

  const publish = async (id: string) => {
    setBusy(true);
    try {
      await rpc('publish_series_month', { p_series: id });
      toast.success(t('Published'));
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Recurring')} subtitle={t('Monthly collections and fixed expenses, with their history')} back="/events" />

      <SectionTitle action={canEvents ? <Button size="sm" variant="outline" onClick={() => setCreate(true)}><Plus /> {t('New')}</Button> : undefined}>
        {t('Recurring events')}
      </SectionTitle>
      <QueryState query={q} empty={() => null}>
        {(d) =>
          d.series.length === 0 ? (
            <EmptyState icon={<Repeat className="size-7" />} title={t('No recurring events')} hint={t('A recurring event is published automatically on the 1st of every month, named with the month and year.')} />
          ) : (
            <div className="space-y-2.5">
              {d.series.map((s) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{s.title}</p>
                      <p className="text-[12.5px] text-muted-foreground">
                        <span className="tabular font-semibold text-foreground">{formatINR(s.total_cost_paise)}</span> {t('a month')} · {t('due by day {{d}}', { d: s.due_day })}
                      </p>
                    </div>
                    <Badge variant={s.is_active ? 'success' : 'muted'}>{s.is_active ? t('Auto every month') : t('Paused')}</Badge>
                  </div>
                  {s.pending_total_paise && s.pending_from_period && (
                    <p className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-[12.5px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      {t('From {{m}}: {{a}}', { m: periodLabel(s.pending_from_period), a: formatINR(s.pending_total_paise) })}
                    </p>
                  )}
                  {s.this_month_event_id && (
                    <Link to={`/events/${s.this_month_event_id}`} className="mt-2 flex items-center justify-between text-[13px] font-semibold text-primary">
                      {t('This month’s event')} <ChevronRight className="size-4" />
                    </Link>
                  )}
                  <History rows={s.history} />
                  {canEvents && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setChange({ kind: 'series', id: s.id, title: s.title, paise: s.total_cost_paise })}>
                        <SlidersHorizontal /> {t('Change amount')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEdit(s)}>
                        <Pencil /> {t('Edit')}
                      </Button>
                      {s.is_active && !s.this_month_event_id && (
                        <Button size="sm" onClick={() => publish(s.id)} loading={busy}>
                          <Send /> {t('Publish this month')}
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )
        }
      </QueryState>

      <SectionTitle>{t('Fixed monthly expenses')}</SectionTitle>
      <QueryState query={q} empty={() => null}>
        {(d) =>
          d.expenses.length === 0 ? (
            <p className="px-1 text-sm text-muted-foreground">{t('No recurring expenses')}</p>
          ) : (
            <div className="space-y-2.5">
              {d.expenses.map((x) => (
                <Card key={x.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">
                        {x.title} {!x.is_active && <Badge variant="muted">{t('Paused')}</Badge>}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">{t('Around day {{d}} of every month', { d: x.day_of_month })}</p>
                    </div>
                    <span className="tabular font-bold">{formatINR(x.amount_paise)}</span>
                  </div>
                  {x.pending_amount_paise && x.pending_from_period && (
                    <p className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-[12.5px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      {t('From {{m}}: {{a}}', { m: periodLabel(x.pending_from_period), a: formatINR(x.pending_amount_paise) })}
                    </p>
                  )}
                  <History rows={x.history} />
                  {canExp && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setChange({ kind: 'expense', id: x.id, title: x.title, paise: x.amount_paise })}>
                        <SlidersHorizontal /> {t('Change amount')}
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/admin/expenses">
                          <Pencil /> {t('Edit')}
                        </Link>
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )
        }
      </QueryState>

      <ChangeAmountDialog
        open={!!change}
        onClose={() => setChange(null)}
        title={change?.title ?? ''}
        currentPaise={change?.paise ?? 0}
        currentPeriod={cur}
        nextPeriod={next}
        onSubmit={submitChange}
      />
      <SeriesCreateDialog open={create} onClose={() => setCreate(false)} types={types.data ?? []} societyId={m.societyId} onDone={refresh} />
      <SeriesEditDialog series={edit} onClose={() => setEdit(null)} onDone={refresh} />
    </div>
  );
}

function SeriesCreateDialog({ open, onClose, types, societyId, onDone }: { open: boolean; onClose: () => void; types: { id: string; name: string }[]; societyId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('10');
  const [scope, setScope] = useState<'all' | 'unit_types'>('all');
  const [ids, setIds] = useState<string[]>([]);
  const [now, setNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const paise = parseRupeesToPaise(amount);
    if (title.trim().length < 3) return toast.error(t('Name must be 3 to 80 characters.'));
    if (!paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    const d = Number(day);
    if (!(d >= 1 && d <= 28)) return toast.error(t('Day must be between 1 and 28.'));
    if (scope === 'unit_types' && ids.length === 0) return toast.error(t('Pick at least one flat type.'));
    setBusy(true);
    try {
      await rpc('create_event_series', {
        p_society: societyId, p_title: title, p_description: null, p_total_cost_paise: paise, p_scope_type: scope,
        p_unit_type_ids: scope === 'unit_types' ? ids : [], p_due_day: d, p_publish_now: now,
      });
      toast.success(t('Saved. Everyone has been notified.'));
      setTitle(''); setAmount('');
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New recurring event')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Name')} hint={t('The month and year are added automatically, e.g. “{{n}} – November 2026”.', { n: title.trim() || t('Security guard salary') })}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={t('Security guard salary')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Total for the month')}>
              <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15000" />
            </Field>
            <Field label={t('Due by day')}>
              <IntInput max={28} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            {(['all', 'unit_types'] as const).map((k) => (
              <Button key={k} type="button" size="sm" variant={scope === k ? 'default' : 'outline'} onClick={() => setScope(k)}>
                {k === 'all' ? t('All flats') : t('Only some flat types')}
              </Button>
            ))}
          </div>
          {scope === 'unit_types' &&
            types.map((ut) => (
              <label key={ut.id} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-semibold">
                <Checkbox checked={ids.includes(ut.id)} onCheckedChange={(v) => setIds((l) => (v === true ? [...l, ut.id] : l.filter((x) => x !== ut.id)))} /> {ut.name}
              </label>
            ))}
          <label className="flex min-h-11 cursor-pointer items-center justify-between">
            <span className="text-sm font-semibold">{t('Publish this month’s event now')}</span>
            <Switch checked={now} onCheckedChange={setNow} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={save} loading={busy}>{t('Create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SeriesEditDialog({ series, onClose, onDone }: { series: Series | null; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [day, setDay] = useState('10');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (series && loaded !== series.id) {
    setLoaded(series.id);
    setTitle(series.title);
    setDesc(series.description ?? '');
    setDay(String(series.due_day));
    setActive(series.is_active);
  }
  const save = async () => {
    if (!series) return;
    const d = Number(day);
    if (title.trim().length < 3) return toast.error(t('Name must be 3 to 80 characters.'));
    if (!(d >= 1 && d <= 28)) return toast.error(t('Day must be between 1 and 28.'));
    setBusy(true);
    try {
      await rpc('update_event_series', { p_series: series.id, p_title: title, p_description: desc || null, p_due_day: d, p_is_active: active });
      toast.success(t('Saved. Everyone has been notified.'));
      setLoaded(null);
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!series} onOpenChange={(o) => { if (!o) { setLoaded(null); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Edit recurring event')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Name')} hint={t('Applies from the next event. Published months keep their name.')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('Due by day')}>
            <IntInput max={28} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label={t('Description')} optional>
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} rows={3} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center justify-between">
            <span className="text-sm font-semibold">{t('Publish automatically every month')}</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setLoaded(null); onClose(); }}>{t('Cancel')}</Button>
          <Button onClick={save} loading={busy}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
