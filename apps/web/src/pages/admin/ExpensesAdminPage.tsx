import { IntInput } from '@/components/IntInput';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Repeat, SkipForward, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { currentPeriod, formatINR, paiseToInput, parseRupeesToPaise, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useExpenseCategories, useFunds } from '@/lib/queries';
import { categoryLabel, MODE_LABELS } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AmountInput } from '@/components/AmountInput';
import { Input, NativeSelect } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Template = {
  id: string;
  title: string;
  fund_id: string;
  category: string;
  payee: string | null;
  amount_paise: number;
  day_of_month: number;
  payment_mode: string | null;
  is_active: boolean;
};
type Draft = {
  id: string;
  period: string;
  amount_paise: number;
  status: string;
  expense_templates: { title: string; payee: string | null };
};
type Form = {
  open: boolean;
  id?: string;
  title: string;
  fund_id: string;
  category: string;
  payee: string;
  amount: string;
  day: string;
  mode: string;
  active: boolean;
};

const empty: Form = {
  open: false,
  title: '',
  fund_id: '',
  category: 'salary',
  payee: '',
  amount: '',
  day: '1',
  mode: 'cash',
  active: true,
};

export default function ExpensesAdminPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const funds = useFunds(m.societyId);
  const cats = useExpenseCategories(m.societyId);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);

  const templates = useQuery({
    queryKey: ['templates', m.societyId],
    queryFn: async () =>
      unwrap<Template[]>(
        await supabase
          .from('expense_templates')
          .select('*')
          .eq('society_id', m.societyId)
          .order('day_of_month'),
      ),
  });
  const drafts = useQuery({
    queryKey: ['drafts', m.societyId],
    queryFn: async () =>
      unwrap<Draft[]>(
        await supabase
          .from('expense_drafts')
          .select('id, period, amount_paise, status, expense_templates(title, payee)')
          .eq('society_id', m.societyId)
          .eq('status', 'pending')
          .order('period'),
      ),
  });

  if (!m.can('record_expense')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const generate = async () => {
    try {
      const r = await rpc<{ created: number }>('generate_expense_drafts', {
        p_society: m.societyId,
        p_period: currentPeriod(),
      });
      toast.success(
        r.created ? t('{{n}} draft(s) created', { n: r.created }) : t('Drafts for this month already exist'),
      );
      void qc.invalidateQueries({ queryKey: ['drafts'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const skip = async (id: string) => {
    try {
      await rpc('skip_expense_draft', { p_draft_id: id });
      void qc.invalidateQueries({ queryKey: ['drafts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const save = async () => {
    const paise = parseRupeesToPaise(form.amount);
    if (form.title.trim().length < 2) return toast.error(t('Title is required.'));
    if (!paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    const day = Number(form.day);
    if (!(day >= 1 && day <= 28)) return toast.error(t('Day must be between 1 and 28.'));
    setBusy(true);
    try {
      await rpc('upsert_expense_template', {
        p_society: m.societyId,
        p_id: form.id ?? null,
        p_title: form.title,
        p_fund_id: form.fund_id || funds.data?.find((f) => f.kind === 'general')?.id,
        p_category: form.category,
        p_payee: form.payee || null,
        p_amount_paise: paise,
        p_day_of_month: day,
        p_payment_mode: form.mode || null,
        p_is_active: form.active,
      });
      setForm(empty);
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(t('Saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Recurring expenses')}
        subtitle={t('Like the guard’s salary — confirm each month with one tap')}
        back="/more"
      />

      <SectionTitle
        action={
          <Button variant="link" size="sm" onClick={generate}>
            <Wand2 /> {t('Create this month’s drafts')}
          </Button>
        }
      >
        {t('Waiting for confirmation')}
      </SectionTitle>
      <QueryState
        query={drafts}
        empty={(d) =>
          d.length ? null : (
            <p className="px-1 text-sm text-muted-foreground">{t('Nothing to confirm right now.')}</p>
          )
        }
      >
        {(list) => (
          <div className="space-y-2">
            {list.map((d) => (
              <Card key={d.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">{d.expense_templates.title}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {periodLabel(d.period)} · {formatINR(d.amount_paise)}
                  </p>
                </div>
                <Button size="sm" asChild>
                  <Link to={`/admin/expense?draft=${d.id}`}>
                    <Check /> {t('Confirm')}
                  </Link>
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => skip(d.id)}
                  aria-label={t('Skip this month')}
                >
                  <SkipForward />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </QueryState>

      <SectionTitle
        action={
          <Button size="sm" variant="outline" onClick={() => setForm({ ...empty, open: true })}>
            <Plus /> {t('Add')}
          </Button>
        }
      >
        {t('Templates')}
      </SectionTitle>
      <QueryState
        query={templates}
        empty={(d) =>
          d.length ? null : (
            <EmptyState icon={<Repeat className="size-7" />} title={t('No recurring expenses')} />
          )
        }
      >
        {(list) => (
          <Card className="divide-y">
            {list.map((tp) => (
              <div key={tp.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {tp.title} {!tp.is_active && <Badge variant="muted">{t('Paused')}</Badge>}
                  </p>
                  <p className="truncate text-[12.5px] text-muted-foreground">
                    {formatINR(tp.amount_paise)} · {t('day {{d}}', { d: tp.day_of_month })} ·{' '}
                    {categoryLabel(tp.category, cats.data)}
                    {tp.payee ? ` · ${tp.payee}` : ''}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('Edit')}
                  onClick={() =>
                    setForm({
                      open: true,
                      id: tp.id,
                      title: tp.title,
                      fund_id: tp.fund_id,
                      category: tp.category,
                      payee: tp.payee ?? '',
                      amount: paiseToInput(tp.amount_paise),
                      day: String(tp.day_of_month),
                      mode: tp.payment_mode ?? '',
                      active: tp.is_active,
                    })
                  }
                >
                  <Pencil />
                </Button>
              </div>
            ))}
          </Card>
        )}
      </QueryState>

      <Dialog open={form.open} onOpenChange={(o) => !o && setForm(empty)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? t('Edit template') : t('New recurring expense')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t('Title')}>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                maxLength={80}
                placeholder={t('Security guard salary')}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Amount')}>
                <AmountInput
                  value={form.amount}
                  disabled={!!form.id}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </Field>
              <Field label={t('Day of month')}>
                <IntInput
                  max={28}
                  value={form.day}
                  onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                />
              </Field>
            </div>
            {form.id && (
              <p className="text-[12.5px] text-muted-foreground">
                {t('To change the amount, use')}{' '}
                <Link to="/events/recurring" className="font-semibold text-primary underline">
                  {t('Change amount')}
                </Link>{' '}
                {t('so the history is kept and everyone is told.')}
              </p>
            )}
            <Field label={t('Category')}>
              <NativeSelect
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {cats.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {t(c.label)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('Paid to')} optional>
              <Input
                value={form.payee}
                onChange={(e) => setForm((f) => ({ ...f, payee: e.target.value }))}
                maxLength={120}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Fund')}>
                <NativeSelect
                  value={form.fund_id || funds.data?.find((f) => f.kind === 'general')?.id || ''}
                  onChange={(e) => setForm((f) => ({ ...f, fund_id: e.target.value }))}
                >
                  {funds.data
                    ?.filter((f) => f.is_active)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label={t('Mode')}>
                <NativeSelect
                  value={form.mode}
                  onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
                >
                  {Object.entries(MODE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center justify-between">
              <span className="text-sm font-semibold">{t('Active')}</span>
              <Switch checked={form.active} onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))} />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(empty)}>
              {t('Cancel')}
            </Button>
            <Button onClick={save} loading={busy}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
