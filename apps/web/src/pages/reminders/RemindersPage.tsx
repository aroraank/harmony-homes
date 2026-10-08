import { IntInput } from '@/components/IntInput';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRing, CheckCircle2, Pause, Pencil, Play, Plus, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDate, formatINR, istToday, parseRupeesToPaise } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, newIdemKey, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useContactCategories, useExpenseCategories, useUnitTypes } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AmountInput } from '@/components/AmountInput';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ReminderCards } from './ReminderCards';
import type { ReminderSchedule } from '@/types';

type TaskLog = { id: string; schedule_id: string; done_on: string; cost_paise: number | null; note: string | null; created_at: string };
type Occ = { id: string; schedule_id: string; due_date: string };
type Draft = Partial<ReminderSchedule> & { open: boolean };

export default function RemindersPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canManage = m.can('manage_reminders');
  const types = useUnitTypes(m.societyId);
  const ccats = useContactCategories(m.societyId);
  const [draft, setDraft] = useState<Draft>({ open: false });
  const [del, setDel] = useState<ReminderSchedule | null>(null);
  const [task, setTask] = useState<ReminderSchedule | null>(null);
  const [busy, setBusy] = useState(false);

  const schedules = useQuery({
    queryKey: ['reminders', m.societyId],
    enabled: canManage,
    queryFn: async () => {
      const list = unwrap<ReminderSchedule[]>(await supabase.from('reminder_schedules').select('*').eq('society_id', m.societyId).is('deleted_at', null).order('next_date'));
      const ids = list.map((s) => s.id);
      const logs = ids.length ? unwrap<TaskLog[]>(await supabase.from('reminder_task_logs').select('*').in('schedule_id', ids).order('done_on', { ascending: false })) : [];
      const occs = ids.length ? unwrap<Occ[]>(await supabase.from('reminder_occurrences').select('id, schedule_id, due_date').in('schedule_id', ids).order('due_date', { ascending: false })) : [];
      const counts: Record<string, number> = {};
      for (const s of list.filter((x) => x.kind === 'advisory')) {
        const latest = occs.find((o) => o.schedule_id === s.id);
        if (latest) counts[s.id] = await rpc<number>('reminder_done_count', { p_occurrence_id: latest.id });
      }
      return { list, logs, counts };
    },
  });

  useEffect(() => {
    const id = params.get('task');
    const s = schedules.data?.list.find((x) => x.id === id);
    if (s) setTask(s);
  }, [params, schedules.data]);

  const save = async () => {
    const d = draft;
    if ((d.title ?? '').trim().length < 3) return toast.error(t('Title must be 3–80 characters.'));
    if (!(d.message ?? '').trim()) return toast.error(t('Message must be 1–500 characters.'));
    if (!d.next_date) return toast.error(t('Choose the next date.'));
    setBusy(true);
    try {
      await rpc('upsert_reminder', {
        p_society: m.societyId,
        p_id: d.id ?? null,
        p_title: d.title,
        p_message: d.message,
        p_interval_unit: d.interval_unit ?? 'months',
        p_interval_count: d.interval_count ?? 6,
        p_next_date: d.next_date,
        p_audience_type: d.audience_type ?? 'all',
        p_unit_type_ids: d.audience_unit_type_ids ?? [],
        p_unit_ids: d.audience_unit_ids ?? [],
        p_contact_category_id: d.contact_category_id || null,
        p_kind: d.kind ?? 'advisory',
      });
      toast.success(t('Reminder saved'));
      setDraft({ open: false });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pause = async (s: ReminderSchedule) => {
    try {
      await rpc('set_reminder_paused', { p_id: s.id, p_paused: !s.is_paused });
      void qc.invalidateQueries({ queryKey: ['reminders'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!del) return;
    setBusy(true);
    try {
      await rpc('delete_reminder', { p_id: del.id });
      setDel(null);
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['reminderCards'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Maintenance reminders')}
        back="/more"
        actions={
          canManage && (
            <Button size="sm" onClick={() => setDraft({ open: true, kind: 'advisory', interval_unit: 'months', interval_count: 6, audience_type: 'all', next_date: addDays(istToday(), 1) })}>
              <Plus /> {t('New')}
            </Button>
          )
        }
      />
      <ReminderCards />
      {!canManage && <p className="mt-6 text-center text-sm text-muted-foreground">{t('Reminders like tank cleaning appear here when they are due. They are optional — nobody is chased.')}</p>}

      {canManage && (
        <>
          <SectionTitle>{t('Schedules')}</SectionTitle>
          <QueryState query={schedules} empty={(d) => (d.list.length ? null : <EmptyState icon={<BellRing className="size-7" />} title={t('No reminders yet')} />)}>
            {({ list, logs, counts }) => (
              <div className="space-y-2.5">
                {list.map((s) => {
                  const sl = logs.filter((l) => l.schedule_id === s.id);
                  return (
                    <Card key={s.id} className={cn('p-4', s.is_paused && 'opacity-70')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-bold">{s.title}</p>
                          <p className="text-[12.5px] text-muted-foreground">
                            {t('Every {{n}} {{u}}', { n: s.interval_count, u: t(s.interval_unit) })} · {t('next {{d}}', { d: formatDate(s.next_date) })}
                          </p>
                        </div>
                        <Badge variant={s.kind === 'task' ? 'info' : 'lime'}>{s.kind === 'task' ? t('Society task') : t('Advisory')}</Badge>
                      </div>
                      <p className="mt-1.5 text-[13px]">{s.message}</p>
                      {s.kind === 'advisory' && counts[s.id] !== undefined && <p className="mt-1 text-[12px] text-muted-foreground">{t('{{n}} flats marked done (anonymous count)', { n: counts[s.id] })}</p>}
                      {s.kind === 'task' && sl.length > 0 && (
                        <div className="mt-2 rounded-xl bg-muted/50 p-2.5 text-[12.5px]">
                          {sl.slice(0, 3).map((l) => (
                            <p key={l.id}>
                              ✓ {formatDate(l.done_on)}
                              {l.cost_paise ? ` · ${formatINR(l.cost_paise)}` : ''}
                              {l.note ? ` · ${l.note}` : ''}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {s.kind === 'task' && (
                          <Button size="sm" onClick={() => setTask(s)}>
                            <CheckCircle2 /> {t('Mark done')}
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setDraft({ ...s, open: true })}>
                          <Pencil /> {t('Edit')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => pause(s)}>
                          {s.is_paused ? <Play /> : <Pause />} {s.is_paused ? t('Resume') : t('Pause')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDel(s)}>
                          <Trash2 /> {t('Delete')}
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </QueryState>
        </>
      )}

      <Dialog open={draft.open} onOpenChange={(o) => !o && setDraft({ open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? t('Edit reminder') : t('New reminder')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['advisory', 'task'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                  className={cn('min-h-14 cursor-pointer rounded-xl border px-3 text-left text-[13px]', draft.kind === k ? 'border-primary bg-primary/10' : 'hover:bg-secondary')}
                >
                  <span className="block font-semibold">{k === 'advisory' ? t('Advisory') : t('Society task')}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{k === 'advisory' ? t('Each flat decides') : t('Admins mark it done')}</span>
                </button>
              ))}
            </div>
            <Field label={t('Title')}>
              <Input value={draft.title ?? ''} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={80} />
            </Field>
            <Field label={t('Message')}>
              <Textarea rows={3} value={draft.message ?? ''} onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))} maxLength={500} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Repeat every')}>
                <IntInput max={365} value={String(draft.interval_count ?? 6)} onChange={(e) => setDraft((d) => ({ ...d, interval_count: Number(e.target.value) }))} />
              </Field>
              <Field label={t('Unit')}>
                <NativeSelect value={draft.interval_unit ?? 'months'} onChange={(e) => setDraft((d) => ({ ...d, interval_unit: e.target.value as 'days' | 'months' }))}>
                  <option value="days">{t('days')}</option>
                  <option value="months">{t('months')}</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label={t('Next date')}>
              <Input type="date" min={istToday()} value={draft.next_date ?? ''} onChange={(e) => setDraft((d) => ({ ...d, next_date: e.target.value }))} />
            </Field>
            <Field label={t('Audience')}>
              <NativeSelect value={draft.audience_type ?? 'all'} onChange={(e) => setDraft((d) => ({ ...d, audience_type: e.target.value as ReminderSchedule['audience_type'] }))}>
                <option value="all">{t('All flats')}</option>
                <option value="unit_types">{t('Flat types')}</option>
              </NativeSelect>
            </Field>
            {draft.audience_type === 'unit_types' && (
              <div className="flex flex-wrap gap-2">
                {types.data?.map((ty) => (
                  <label key={ty.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3">
                    <Checkbox
                      checked={(draft.audience_unit_type_ids ?? []).includes(ty.id)}
                      onCheckedChange={() =>
                        setDraft((d) => {
                          const l = d.audience_unit_type_ids ?? [];
                          return { ...d, audience_unit_type_ids: l.includes(ty.id) ? l.filter((x) => x !== ty.id) : [...l, ty.id] };
                        })
                      }
                    />
                    <span className="text-sm font-semibold">{ty.name}</span>
                  </label>
                ))}
              </div>
            )}
            <Field label={t('Linked contacts')} optional>
              <NativeSelect value={draft.contact_category_id ?? ''} onChange={(e) => setDraft((d) => ({ ...d, contact_category_id: e.target.value || null }))}>
                <option value="">{t('None')}</option>
                {ccats.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.name)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ open: false })}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={busy}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmSheet open={!!del} onOpenChange={(o) => !o && setDel(null)} title={t('Delete this reminder?')} description={t('Its history is kept in the audit log.')} confirmLabel={t('Delete')} destructive loading={busy} onConfirm={remove} />
      {task && (
        <TaskDoneSheet
          schedule={task}
          onClose={() => {
            setTask(null);
            if (params.get('task')) setParams({}, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function TaskDoneSheet({ schedule, onClose }: { schedule: ReminderSchedule; onClose: () => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const cats = useExpenseCategories(m.societyId);
  const [doneOn, setDoneOn] = useState(istToday());
  const [cost, setCost] = useState('');
  const [post, setPost] = useState(false);
  const [category, setCategory] = useState('repair');
  const [payee, setPayee] = useState('');
  const [mode, setMode] = useState('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [idem] = useState(() => newIdemKey('task'));

  const save = async () => {
    const paise = cost ? parseRupeesToPaise(cost) : null;
    if (cost && !paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    if (post && !paise) return toast.error(t('Enter the cost to post an expense.'));
    setBusy(true);
    try {
      await rpc('complete_reminder_task', {
        p_schedule_id: schedule.id,
        p_done_on: doneOn,
        p_cost_paise: paise,
        p_post_expense: post,
        p_fund_id: null,
        p_category: category,
        p_payee: payee || null,
        p_payment_mode: mode,
        p_note: note || null,
        p_idempotency_key: idem,
      });
      toast.success(t('Task marked done'));
      if (post) invalidateMoney(qc);
      void qc.invalidateQueries({ queryKey: ['reminders'] });
      void qc.invalidateQueries({ queryKey: ['reminderCards'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-5 text-primary" /> {schedule.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Done on')}>
            <Input type="date" value={doneOn} max={istToday()} onChange={(e) => setDoneOn(e.target.value)} />
          </Field>
          <Field label={t('Cost')} optional>
            <AmountInput value={cost} onChange={(e) => setCost(e.target.value)} placeholder="₹" />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-semibold">{t('Also record this as an expense')}</span>
            <Switch checked={post} onCheckedChange={setPost} />
          </label>
          {post && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Category')}>
                <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                  {cats.data?.map((c) => (
                    <option key={c.code} value={c.code}>
                      {t(c.label)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={t('Mode')}>
                <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="cash">{t('Cash')}</option>
                  <option value="upi">UPI</option>
                  <option value="bank">{t('Bank transfer')}</option>
                </NativeSelect>
              </Field>
              <Field label={t('Paid to')} optional className="col-span-2">
                <Input value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={120} />
              </Field>
            </div>
          )}
          <Field label={t('Note')} optional>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            <CheckCircle2 /> {t('Mark done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
