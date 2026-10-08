import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, IndianRupee, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDate, formatINR, istToday, normalizeUtr, parseRupeesToPaise, referenceRequired, UTR_RE } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { AppError, errorMessage, newIdemKey, rpc } from '@/lib/supabase';
import { invalidateMoney, useFunds, useUnits } from '@/lib/queries';
import { uploadFile } from '@/lib/files';
import { nudgePush } from '@/lib/push';
import { useDebounced } from '@/lib/useDebounced';
import { useOnline } from '@/lib/online';
import { MODE_LABELS } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { UnitSelect } from '@/components/UnitSelect';
import { FileInput } from '@/components/FileInput';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/States';

type Preview = { allocations: { label: string; amount_paise: number; due_paise: number; already_paid_paise: number }[]; advance_paise: number; existing_advance_paise: number };
type DupMatch = { source: 'ledger' | 'claim'; date: string; amount_paise: number; unit_code: string | null; payee?: string | null; status?: string };

export default function RecordPaymentPage() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const online = useOnline();
  const [params] = useSearchParams();
  const units = useUnits(m.societyId);
  const funds = useFunds(m.societyId);

  const [unitId, setUnitId] = useState(params.get('unit') ?? '');
  const [fundId, setFundId] = useState(params.get('fund') ?? '');
  const [amount, setAmount] = useState(params.get('amount') ?? '');
  const [date, setDate] = useState(istToday());
  const [mode, setMode] = useState('upi');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [backdateReason, setBackdateReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [dupConfirm, setDupConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [idem, setIdem] = useState(() => newIdemKey('pay'));

  const general = funds.data?.find((f) => f.kind === 'general');
  const activeFunds = (funds.data ?? []).filter((f) => f.is_active);
  const fund = activeFunds.find((f) => f.id === fundId) ?? general;
  const paise = parseRupeesToPaise(amount);
  const unit = units.data?.find((u) => u.id === unitId);
  const needsReason = date < addDays(istToday(), -30);

  const dAmount = useDebounced(paise);
  const preview = useQuery({
    queryKey: ['preview', unitId, fund?.id, dAmount],
    enabled: !!unitId && !!fund && !!dAmount,
    staleTime: 0,
    queryFn: () => rpc<Preview>('preview_allocation', { p_unit_id: unitId, p_amount_paise: dAmount, p_fund_id: fund!.id }),
  });
  const dUtr = useDebounced(normalizeUtr(utr), 500);
  const dup = useQuery({
    queryKey: ['dupRef', dUtr],
    enabled: UTR_RE.test(dUtr),
    staleTime: 0,
    queryFn: () => rpc<DupMatch[]>('check_duplicate_reference', { p_society: m.societyId, p_reference: dUtr }),
  });

  useEffect(() => setIdem(newIdemKey('pay')), [unitId, fundId, amount, date, mode, utr]);

  const coverText = useMemo(() => {
    const p = preview.data;
    if (!p) return '';
    const parts = p.allocations.map((a) => `${a.label} ${formatINR(a.amount_paise)}`);
    let s = parts.length ? t('covers {{list}}', { list: parts.join(' + ') }) : t('no pending dues');
    if (p.advance_paise > 0) s += `, ${t('{{a}} advance', { a: formatINR(p.advance_paise) })}`;
    return s;
  }, [preview.data, t]);

  if (!m.can('record_payment')) return <EmptyState title={t('You do not have permission to do this.')} />;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!unitId) e.unit = t('Choose the flat');
    if (!paise) e.amount = t('Enter an amount like 800 or 800.50');
    else if (paise > 1_000_000_000) e.amount = t('Maximum ₹1,00,00,000 per entry');
    if (!date || date > istToday()) e.date = t('Date cannot be in the future');
    const ref = normalizeUtr(utr);
    if (referenceRequired(mode) && !UTR_RE.test(ref)) e.utr = t('UTR / transaction ID is required for UPI and bank payments (6–30 letters or digits).');
    else if (ref && !UTR_RE.test(ref)) e.utr = t('UTR / reference must be 6–30 letters or digits');
    if (needsReason && backdateReason.trim().length < 5) e.reason = t('Entries dated more than 30 days ago need a reason (at least 5 characters).');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (allowDuplicate = false) => {
    setSaving(true);
    try {
      const path = file ? await uploadFile(m.societyId, 'ledger', 'payments', file) : null;
      const res = await rpc<{ entry_id: string; receipt_no: string }>('record_payment', {
        p_unit_id: unitId,
        p_amount_paise: paise,
        p_entry_date: date,
        p_payment_mode: mode,
        p_reference_no: normalizeUtr(utr) || null,
        p_note: note || null,
        p_attachment_path: path,
        p_idempotency_key: idem,
        p_fund_id: fund?.id ?? null,
        p_backdate_reason: needsReason ? backdateReason : null,
        p_allow_duplicate_reference: allowDuplicate,
      });
      invalidateMoney(qc);
      nudgePush();
      setConfirm(false);
      setDupConfirm(false);
      toast.success(t('{{a}} recorded for {{u}} — receipt {{r}}', { a: formatINR(paise ?? 0), u: unit?.code ?? '', r: res.receipt_no }), {
        action: { label: t('View'), onClick: () => nav(`/receipts/${res.entry_id}`) },
      });
      setAmount('');
      setUtr('');
      setNote('');
      setFile(null);
      setBackdateReason('');
      setIdem(newIdemKey('pay'));
    } catch (e) {
      if (e instanceof AppError && e.isDuplicateReference) {
        setConfirm(false);
        setDupConfirm(true);
      } else toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const summary = [
    { label: t('Flat'), value: unit ? `${unit.code} — ${unit.display_name}` : '' },
    { label: t('Amount'), value: formatINR(paise ?? 0), strong: true },
    { label: t('Fund'), value: fund?.name ?? '' },
    { label: t('Date'), value: formatDate(date) },
    { label: t('Mode'), value: MODE_LABELS[mode] },
    ...(utr ? [{ label: t('UTR / reference'), value: normalizeUtr(utr) }] : []),
    ...(coverText ? [{ label: t('Allocation'), value: coverText }] : []),
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Record payment')} subtitle={t('Money received from a flat')} back />
      <Card className="space-y-4 p-4">
        <Field label={t('Flat')} error={errors.unit}>
          <UnitSelect units={units.data ?? []} value={unitId} onChange={(e) => setUnitId(e.target.value)} />
        </Field>
        {activeFunds.length > 1 && (
          <Field label={t('For')}>
            <NativeSelect value={fund?.id ?? ''} onChange={(e) => setFundId(e.target.value)}>
              {activeFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.kind === 'general' ? t('Maintenance (General fund)') : f.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label={t('Amount')} error={errors.amount}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">₹</span>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular pl-8 text-xl font-bold" placeholder="800" />
          </div>
        </Field>
        {unitId && paise && preview.data && (
          <div className="flex items-start gap-2 rounded-2xl bg-secondary px-3.5 py-3 text-[13.5px] text-secondary-foreground">
            <Sparkles className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>{t('This payment')}</strong> {coverText}.
              {preview.data.existing_advance_paise > 0 && ` ${t('Flat already has {{a}} advance.', { a: formatINR(preview.data.existing_advance_paise) })}`}
            </span>
          </div>
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
        <Field label={t('UTR / reference')} optional={!referenceRequired(mode)} error={errors.utr}>
          <Input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </Field>
        {dup.data && dup.data.length > 0 && (
          <Alert variant="warning">
            <AlertTriangle />
            <div>
              <p className="font-semibold">{t('This UTR already exists')}</p>
              {dup.data.map((d, i) => (
                <p key={i} className="text-[12.5px]">
                  {d.source === 'claim' ? t('Pending claim') : t('Ledger')}: {formatINR(d.amount_paise)} · {d.unit_code ?? d.payee ?? ''} · {formatDate(d.date)}
                </p>
              ))}
            </div>
          </Alert>
        )}
        <Field label={t('Screenshot / proof')} optional>
          <FileInput value={file} onChange={setFile} />
        </Field>
        <Field label={t('Note')} optional>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        <Button size="xl" variant="hero" className="w-full" disabled={!online} onClick={() => validate() && setConfirm(true)}>
          <IndianRupee /> {t('Review and save')}
        </Button>
      </Card>

      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Save this payment?')}
        description={t('Once saved it cannot be edited — only reversed with a reason.')}
        rows={summary}
        confirmLabel={t('Save payment')}
        loading={saving}
        onConfirm={() => save(false)}
      />
      <ConfirmSheet
        open={dupConfirm}
        onOpenChange={setDupConfirm}
        title={t('Duplicate UTR')}
        description={t('This UTR / reference is already in the ledger or a pending claim. Record it anyway only if you are sure it is a different payment.')}
        rows={summary}
        confirmLabel={t('Record anyway')}
        destructive
        loading={saving}
        onConfirm={() => save(true)}
      />
    </div>
  );
}
