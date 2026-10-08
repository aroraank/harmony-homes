import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDate, formatINR, istToday, normalizeUtr, paiseToInput, parseRupeesToPaise, UTR_RE } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { AppError, errorMessage, newIdemKey, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useDashboard, useExpenseCategories, useFunds } from '@/lib/queries';
import { uploadFile } from '@/lib/files';
import { useOnline } from '@/lib/online';
import { MODE_LABELS } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { FileInput } from '@/components/FileInput';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AmountInput } from '@/components/AmountInput';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/States';

type Draft = { id: string; period: string; amount_paise: number; status: string; expense_templates: { title: string; fund_id: string; category: string; payee: string | null; payment_mode: string | null } };

export default function RecordExpensePage() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const [params] = useSearchParams();
  const draftId = params.get('draft');
  const funds = useFunds(m.societyId);
  const cats = useExpenseCategories(m.societyId);
  const dash = useDashboard(m.societyId);
  const payees = useQuery({
    queryKey: ['payees', m.societyId],
    queryFn: () => rpc<{ payee: string }[]>('payee_list', { p_society: m.societyId }),
  });
  const draft = useQuery({
    queryKey: ['draft', draftId],
    enabled: !!draftId,
    queryFn: async () =>
      unwrap<Draft>(await supabase.from('expense_drafts').select('id, period, amount_paise, status, expense_templates(title, fund_id, category, payee, payment_mode)').eq('id', draftId!).single()),
  });

  const [fundId, setFundId] = useState(params.get('fund') ?? '');
  const [category, setCategory] = useState('');
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(istToday());
  const [mode, setMode] = useState('cash');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [dupConfirm, setDupConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idem, setIdem] = useState(() => newIdemKey('exp'));
  const [newCat, setNewCat] = useState<{ open: boolean; label: string }>({ open: false, label: '' });

  useEffect(() => {
    const d = draft.data;
    if (!d) return;
    setFundId(d.expense_templates.fund_id);
    setCategory(d.expense_templates.category);
    setPayee(d.expense_templates.payee ?? '');
    setAmount(paiseToInput(d.amount_paise));
    if (d.expense_templates.payment_mode) setMode(d.expense_templates.payment_mode);
    setNote(`${d.expense_templates.title} — ${d.period}`);
  }, [draft.data]);

  useEffect(() => setIdem(newIdemKey('exp')), [fundId, category, payee, amount, date, mode, ref]);

  if (!m.can('record_expense')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const activeFunds = (funds.data ?? []).filter((f) => f.is_active);
  const fund = activeFunds.find((f) => f.id === fundId) ?? activeFunds.find((f) => f.kind === 'general');
  const paise = parseRupeesToPaise(amount);
  const needsReason = date < addDays(istToday(), -30);
  const fundBalance = dash.data?.funds.find((f) => f.id === fund?.id)?.balance_paise;
  const goesNegative = paise && fundBalance !== undefined && fundBalance - paise < 0;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fund) e.fund = t('Choose a fund');
    if (!category) e.category = t('Choose a category');
    if (!paise) e.amount = t('Enter an amount like 800 or 800.50');
    if (!date || date > istToday()) e.date = t('Date cannot be in the future');
    const r = normalizeUtr(ref);
    if (r && !UTR_RE.test(r)) e.ref = t('UTR / reference must be 6–30 letters or digits');
    if (needsReason && backdateReason.trim().length < 5) e.reason = t('Entries dated more than 30 days ago need a reason (at least 5 characters).');
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (allowDuplicate = false) => {
    setSaving(true);
    try {
      const path = file ? await uploadFile(m.societyId, 'ledger', 'expenses', file) : null;
      await rpc('record_expense', {
        p_fund_id: fund!.id,
        p_category: category,
        p_payee: payee || null,
        p_amount_paise: paise,
        p_entry_date: date,
        p_payment_mode: mode,
        p_reference_no: normalizeUtr(ref) || null,
        p_note: note || null,
        p_attachment_path: path,
        p_idempotency_key: idem,
        p_backdate_reason: needsReason ? backdateReason : null,
        p_draft_id: draftId && draft.data?.status === 'pending' ? draftId : null,
        p_allow_duplicate_reference: allowDuplicate,
      });
      invalidateMoney(qc);
      toast.success(t('Expense of {{a}} recorded', { a: formatINR(paise ?? 0) }));
      if (draftId) nav('/admin/expenses');
      else {
        setAmount('');
        setRef('');
        setNote('');
        setFile(null);
        setConfirm(false);
        setDupConfirm(false);
      }
    } catch (e) {
      if (e instanceof AppError && e.isDuplicateReference) {
        setConfirm(false);
        setDupConfirm(true);
      } else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const addCategory = async () => {
    const label = newCat.label.trim();
    const code = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) return toast.error(t('Use a name that starts with a letter.'));
    try {
      await rpc('upsert_expense_category', { p_society: m.societyId, p_code: code, p_label: label });
      await qc.invalidateQueries({ queryKey: ['expenseCategories'] });
      setCategory(code);
      setNewCat({ open: false, label: '' });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const catLabel = cats.data?.find((c) => c.code === category)?.label ?? category;
  const summary = [
    { label: t('Amount'), value: formatINR(paise ?? 0), strong: true },
    { label: t('Fund'), value: fund?.name ?? '' },
    { label: t('Category'), value: catLabel },
    ...(payee ? [{ label: t('Payee'), value: payee }] : []),
    { label: t('Date'), value: formatDate(date) },
    { label: t('Mode'), value: MODE_LABELS[mode] },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={draftId ? t('Confirm recurring expense') : t('Record expense')} subtitle={t('Money paid out of society funds')} back />
      {draft.data && draft.data.status !== 'pending' && <Alert variant="warning" className="mb-3">{t('This draft was already handled.')}</Alert>}
      <Card className="space-y-4 p-4">
        {activeFunds.length > 1 && (
          <Field label={t('Paid from fund')} error={errors.fund}>
            <NativeSelect value={fund?.id ?? ''} onChange={(e) => setFundId(e.target.value)}>
              {activeFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label={t('Category')} error={errors.category}>
          <div className="flex gap-2">
            <div className="flex-1">
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('Choose…')}</option>
                {cats.data?.map((c) => (
                  <option key={c.code} value={c.code}>
                    {t(c.label)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => setNewCat({ open: true, label: '' })} aria-label={t('Add category')}>
              <Plus />
            </Button>
          </div>
        </Field>
        <Field label={t('Paid to')} optional>
          <Input value={payee} onChange={(e) => setPayee(e.target.value)} list="payee-list" maxLength={120} placeholder={t('e.g. Security guard, PSPCL')} />
        </Field>
        <datalist id="payee-list">
          {payees.data?.map((p) => <option key={p.payee} value={p.payee} />)}
        </datalist>
        <Field label={t('Amount')} error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">₹</span>
            <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular pl-8 text-xl font-bold" />
          </div>
        </Field>
        {goesNegative && (
          <Alert variant="warning">
            <AlertTriangle />
            {t('This takes {{f}} below zero (balance {{b}}). Check the amount, or move money into this fund first.', {
              f: fund?.name ?? '',
              b: formatINR(fundBalance ?? 0),
            })}
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Date')} error={errors.date}>
            <Input type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={t('Mode')}>
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {needsReason && (
          <Field label={t('Why is this backdated?')} error={errors.reason}>
            <Input value={backdateReason} onChange={(e) => setBackdateReason(e.target.value)} maxLength={200} />
          </Field>
        )}
        <Field label={t('UTR / reference')} optional error={errors.ref}>
          <Input value={ref} onChange={(e) => setRef(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 30))} autoCapitalize="characters" />
        </Field>
        <Field label={t('Bill photo')} optional>
          <FileInput value={file} onChange={setFile} label={t('Add bill photo or PDF')} />
        </Field>
        <Field label={t('Note')} optional>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <Button size="xl" variant="hero" className="w-full" disabled={!online || (draftId != null && draft.data?.status !== 'pending' && !!draft.data)} onClick={() => validate() && setConfirm(true)}>
          <Receipt /> {t('Review and save')}
        </Button>
      </Card>

      <ConfirmSheet open={confirm} onOpenChange={setConfirm} title={t('Save this expense?')} description={t('Once saved it cannot be edited — only reversed with a reason.')} rows={summary} confirmLabel={t('Save expense')} loading={saving} onConfirm={() => save(false)} />
      <ConfirmSheet open={dupConfirm} onOpenChange={setDupConfirm} title={t('Duplicate UTR')} description={t('This reference already exists in the ledger. Record anyway only if it is a different payment.')} rows={summary} confirmLabel={t('Record anyway')} destructive loading={saving} onConfirm={() => save(true)} />

      <Dialog open={newCat.open} onOpenChange={(o) => setNewCat((s) => ({ ...s, open: o }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('New expense category')}</DialogTitle>
          </DialogHeader>
          <Field label={t('Name')}>
            <Input value={newCat.label} onChange={(e) => setNewCat((s) => ({ ...s, label: e.target.value }))} maxLength={40} placeholder={t('e.g. Garden maintenance')} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCat({ open: false, label: '' })}>
              {t('Cancel')}
            </Button>
            <Button onClick={addCategory} disabled={newCat.label.trim().length < 2}>
              {t('Add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
