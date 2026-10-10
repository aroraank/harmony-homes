import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  Send,
  Smartphone,
  Trophy,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  buildUpiLink,
  formatINR,
  isMobileDevice,
  istToday,
  normalizeUtr,
  paiseToInput,
  parseRupeesToPaise,
  referenceRequired,
  UTR_RE,
  upiTransactionNote,
} from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { usePayInfo, invalidateMoney } from '@/lib/queries';
import { signedUrl, uploadFile } from '@/lib/files';
import { nudgePush } from '@/lib/push';
import { useOnline } from '@/lib/online';
import { cn, unitLabel } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/States';
import { Field } from '@/components/Field';
import { FileInput } from '@/components/FileInput';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AmountInput } from '@/components/AmountInput';
import { DuePicker, sumRemaining, usePendingDues, type AllocPreview } from '@/components/DuePicker';
import { PaymentBreakdown } from '@/components/PaymentBreakdown';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { useDebounced } from '@/lib/useDebounced';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function PayPage() {
  const { t } = useTranslation();
  const m = useMember();
  const info = usePayInfo(m.societyId);
  const qc = useQueryClient();
  const online = useOnline();
  const mobile = isMobileDevice(navigator.userAgent);

  const [fundId, setFundId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'pay' | 'claim' | 'done'>('pay');
  const [qrOpen, setQrOpen] = useState(false);
  const [dueIds, setDueIds] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);

  // claim form
  const [paidOn, setPaidOn] = useState(istToday());
  const [mode, setMode] = useState('upi');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const purposes = useMemo(() => info.data?.purposes ?? [], [info.data]);
  const purpose = purposes.find((p) => p.fund_id === fundId) ?? purposes[0];

  useEffect(() => {
    if (!purpose) return;
    if (!fundId) setFundId(purpose.fund_id);
    const def =
      purpose.pending_paise > 0
        ? purpose.pending_paise
        : purpose.kind === 'general'
          ? (info.data?.monthly_due_paise ?? 0)
          : 0;
    setAmount(paiseToInput(def));
  }, [purpose?.fund_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingQ = usePendingDues(info.data?.unit_id ?? '', purpose?.fund_id);
  const claimPaise = parseRupeesToPaise(amount);
  const dClaim = useDebounced(claimPaise);
  const preview = useQuery({
    queryKey: ['preview', info.data?.unit_id, purpose?.fund_id, dClaim, dueIds.join(',')],
    enabled: confirm && !!info.data?.unit_id && !!purpose && !!dClaim,
    staleTime: 0,
    queryFn: () =>
      rpc<AllocPreview>('preview_allocation', {
        p_unit_id: info.data!.unit_id,
        p_amount_paise: dClaim,
        p_fund_id: purpose!.fund_id,
        p_due_ids: dueIds.length ? dueIds : null,
      }),
  });
  useEffect(() => setDueIds([]), [purpose?.fund_id]);

  const qr = useQuery({
    queryKey: ['qr', info.data?.upi_qr_path],
    enabled: !!info.data?.upi_qr_path,
    staleTime: 40 * 60_000,
    queryFn: () => signedUrl(info.data!.upi_qr_path!),
  });

  if (info.isLoading && !info.data) return <CardSkeleton className="h-96" />;
  if (!info.data) return <ErrorState error={info.error} onRetry={() => info.refetch()} />;
  const d = info.data;
  if (!d.unit_id) return <EmptyState title={t('This login is not linked to a flat')} />;

  const paise = parseRupeesToPaise(amount);
  const note30 = upiTransactionNote(d.unit_code ?? '', {
    period: purpose?.kind === 'general' ? (purpose.oldest_period ?? istToday().slice(0, 7)) : null,
    eventTitle: purpose?.kind === 'event' ? purpose.label : null,
  });
  const upiLink =
    d.upi_id && paise
      ? buildUpiLink({
          upiId: d.upi_id,
          payeeName: d.upi_payee_name || m.society_name,
          amountPaise: paise,
          note: note30,
        })
      : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.upi_id ?? '');
      toast.success(t('UPI ID copied'));
    } catch {
      toast.error(t('Could not copy. Long-press the UPI ID to copy it.'));
    }
  };

  const pickMonths = (ids: string[]) => {
    setDueIds(ids);
    if (ids.length) setAmount(paiseToInput(sumRemaining(pendingQ.data?.pending, ids)));
  };

  const reviewClaim = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const p = parseRupeesToPaise(amount);
    if (!p) return setErr(t('Enter the amount you paid.'));
    const ref = normalizeUtr(utr);
    if (referenceRequired(mode) && !UTR_RE.test(ref))
      return setErr(t('Enter the UTR / transaction ID (6–30 letters or digits).'));
    if (ref && !UTR_RE.test(ref)) return setErr(t('UTR / reference must be 6–30 letters or digits'));
    if (paidOn > istToday()) return setErr(t('Date cannot be in the future'));
    setConfirm(true);
  };

  const submitClaim = async () => {
    setErr(null);
    const p = parseRupeesToPaise(amount);
    if (!p) return setErr(t('Enter the amount you paid.'));
    const ref = normalizeUtr(utr);
    if (referenceRequired(mode) && !UTR_RE.test(ref))
      return setErr(t('Enter the UTR / transaction ID (6–30 letters or digits).'));
    if (ref && !UTR_RE.test(ref)) return setErr(t('UTR / reference must be 6–30 letters or digits'));
    if (paidOn > istToday()) return setErr(t('Date cannot be in the future'));
    setBusy(true);
    try {
      const path = shot ? await uploadFile(m.societyId, 'claims', m.userId, shot) : null;
      await rpc('submit_payment_claim', {
        p_society: m.societyId,
        p_amount_paise: p,
        p_paid_on: paidOn,
        p_payment_mode: mode,
        p_reference_no: ref || null,
        p_screenshot_path: path,
        p_note: note || null,
        p_fund_id: purpose?.fund_id ?? null,
        p_due_ids: dueIds.length ? dueIds : null,
      });
      invalidateMoney(qc);
      nudgePush();
      setConfirm(false);
      setStep('done');
    } catch (e2) {
      setConfirm(false);
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done')
    return (
      <div className="animate-fade-up">
        <PageHeader title={t('Pay')} back="/dues" />
        <Card className="flex flex-col items-center p-6 text-center">
          <CheckCircle2 className="size-14 text-primary" />
          <p className="mt-3 text-lg font-bold">{t('Submitted — pending verification')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              'The admin will check the society bank / UPI account. Your receipt appears automatically once it is confirmed.',
            )}
          </p>
          <div className="mt-5 grid w-full gap-2">
            <Button asChild>
              <Link to="/dues">{t('See my claims')}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/">{t('Back to home')}</Link>
            </Button>
          </div>
        </Card>
      </div>
    );

  const isOnlineMode = mode !== 'cash';

  if (purposes.length === 0)
    return (
      <div className="animate-fade-up">
        <PageHeader title={t('Pay')} subtitle={unitLabel(d.unit_code)} back="/dues" />
        <Card className="relative overflow-hidden border-amber-300 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 p-6 text-center dark:border-amber-500/30 dark:from-amber-500/10 dark:via-yellow-500/10 dark:to-orange-500/10">
          <div className="pointer-events-none absolute -left-6 -top-6 size-28 rounded-full bg-amber-300/40 blur-2xl dark:bg-amber-400/20" />
          <div className="pointer-events-none absolute -bottom-8 -right-8 size-32 rounded-full bg-emerald-300/40 blur-2xl dark:bg-emerald-400/20" />
          <span className="relative mx-auto grid size-20 place-items-center rounded-full bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
            <Trophy className="size-10" />
          </span>
          <p className="relative mt-4 text-xl font-extrabold text-amber-900 dark:text-amber-200">
            {t('All dues are clear! 🎉')}
          </p>
          <p className="relative mt-1 text-[13.5px] text-amber-800/80 dark:text-amber-200/70">
            {t('Nothing pending for your flat right now — nothing to pay.')}
          </p>
          <Button asChild className="relative mt-5 w-full" size="lg">
            <Link to="/">{t('Back to home')}</Link>
          </Button>
        </Card>
      </div>
    );

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Pay')} subtitle={unitLabel(d.unit_code)} back="/dues" />

      <Alert
        variant="danger"
        className="mb-3 border-2 border-red-500 bg-red-50 font-bold text-red-700 dark:bg-red-500/10 dark:text-red-300"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <span>
          {t(
            'Please check with Admin Vipen to confirm the UPI ID before making any online payment. Ask them to confirm it before you pay.',
          )}
        </span>
      </Alert>

      {purposes.length > 1 && (
        <div className="mb-3 grid gap-2" role="radiogroup" aria-label={t('What are you paying for?')}>
          {purposes.map((p) => (
            <button
              key={p.fund_id}
              type="button"
              role="radio"
              aria-checked={p.fund_id === purpose?.fund_id}
              onClick={() => setFundId(p.fund_id)}
              className={cn(
                'flex min-h-[56px] cursor-pointer items-center justify-between rounded-2xl border bg-card px-4 text-left transition-colors',
                p.fund_id === purpose?.fund_id
                  ? 'border-primary ring-2 ring-primary/25'
                  : 'hover:bg-secondary/50',
              )}
            >
              <span className="min-w-0 flex-1 truncate font-semibold">
                {p.kind === 'general' ? t('Maintenance') : p.label}
              </span>
              <span className="tabular shrink-0 font-bold text-debit">{formatINR(p.pending_paise)}</span>
            </button>
          ))}
        </div>
      )}

      <Card className="p-4">
        <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          {t('1. Purpose of payment')}
        </p>
        {purpose && (
          <div className="mb-4">
            <DuePicker
              dues={pendingQ.data?.pending}
              loading={pendingQ.isLoading}
              selected={dueIds}
              onChange={pickMonths}
            />
          </div>
        )}
        <Field
          label={t('Amount')}
          hint={
            purpose && paise && purpose.pending_paise > 0 && paise > purpose.pending_paise
              ? t('More than pending — the extra is kept as advance for next months.')
              : purpose && purpose.pending_paise > 0
                ? t('Pending: {{a}}. You can pay less for a part payment.', {
                    a: formatINR(purpose.pending_paise),
                  })
                : undefined
          }
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
              ₹
            </span>
            <AmountInput
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular pl-8 text-xl font-bold"
            />
          </div>
        </Field>
      </Card>

      <Card className={cn('mt-4 p-4', step === 'claim' && 'border-primary ring-2 ring-primary/25')}>
        <p className="text-lg font-bold">{t('Done? Tell us how you paid')}</p>
        <p className="mb-4 text-[13px] text-muted-foreground">
          {t('Nothing is marked paid automatically — the admin verifies it first.')}
        </p>
        <form onSubmit={reviewClaim} className="space-y-4" noValidate>
          <Field label={t('2. Payment mode')}>
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="upi">UPI</option>
              <option value="gpay">GPay</option>
              <option value="phonepe">PhonePe</option>
              <option value="paytm">Paytm</option>
              <option value="bank">{t('Bank transfer')}</option>
              <option value="cash">{t('Cash')}</option>
            </NativeSelect>
          </Field>

          <Field label={t('3. Payment date')}>
            <Input type="date" value={paidOn} max={istToday()} onChange={(e) => setPaidOn(e.target.value)} />
          </Field>

          <Field label={t('4. Proof of payment')} optional>
            <FileInput value={shot} onChange={setShot} imagesOnly label={t('Add payment screenshot')} />
          </Field>

          {isOnlineMode && (
            <div className="space-y-3 rounded-2xl border border-primary/30 bg-secondary/40 p-3.5">
              <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('5. Pay to this UPI ID')}
              </p>
              {!d.upi_id ? (
                <Alert variant="warning">
                  {t(
                    'The admin has not added the society UPI details yet. Pay as usual and then submit the UTR below.',
                  )}
                </Alert>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-2xl bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-muted-foreground">{t('Society UPI ID')}</p>
                      <p className="select-all break-words font-bold tracking-tight">{d.upi_id}</p>
                      {d.upi_payee_name && (
                        <p className="break-words text-[12px] text-muted-foreground">{d.upi_payee_name}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={copy}>
                      <Copy /> {t('Copy')}
                    </Button>
                  </div>

                  {d.upi_qr_path && (
                    <button
                      type="button"
                      onClick={() => setQrOpen(true)}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border bg-card p-3 text-left hover:bg-secondary/50"
                    >
                      {qr.data ? (
                        <img
                          src={qr.data}
                          alt={t('Society UPI QR code')}
                          className="size-20 rounded-xl border bg-white object-contain"
                        />
                      ) : (
                        <QrCode className="size-12 text-primary" />
                      )}
                      <div>
                        <p className="font-semibold">{t('Scan QR code')}</p>
                        <p className="text-[12.5px] text-muted-foreground">{t('Tap to enlarge or save')}</p>
                      </div>
                    </button>
                  )}

                  {mobile && upiLink && (
                    <Button asChild size="lg" variant="hero" className="w-full">
                      <a href={upiLink}>
                        <Smartphone /> {t('Pay {{amount}}', { amount: formatINR(paise ?? 0) })}
                      </a>
                    </Button>
                  )}
                  <p className="text-[12px] text-muted-foreground">
                    {t('Payment note')}: <span className="tabular font-semibold">{note30}</span>.{' '}
                    {t('If your UPI app shows a warning or limit, scan the QR instead.')}
                  </p>
                </>
              )}
            </div>
          )}

          <Field
            label={t('UTR / transaction ID')}
            optional={!referenceRequired(mode)}
            hint={t('12-digit UPI reference from your payment app')}
          >
            <Input
              value={utr}
              onChange={(e) =>
                setUtr(
                  e.target.value
                    .replace(/[^a-z0-9]/gi, '')
                    .toUpperCase()
                    .slice(0, 30),
                )
              }
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
            />
          </Field>
          <Field label={t('Note')} optional>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </Field>
          {err && <Alert variant="danger">{err}</Alert>}
          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!online}>
            <Send /> {t('Submit for verification')}
          </Button>
        </form>
      </Card>

      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Submit this payment for verification?')}
        description={t(
          'Please check what you are paying for. The admin verifies it before it is added to your account.',
        )}
        rows={[
          { label: t('Flat'), value: unitLabel(d.unit_code) },
          { label: t('Amount'), value: formatINR(claimPaise ?? 0), strong: true },
          { label: t('Paid on'), value: paidOn },
          ...(utr ? [{ label: t('UTR / transaction ID'), value: normalizeUtr(utr) }] : []),
        ]}
        confirmLabel={t('Yes, submit')}
        loading={busy}
        onConfirm={() => void submitClaim()}
      >
        <PaymentBreakdown
          preview={preview.data && dClaim === claimPaise && !preview.isFetching ? preview.data : undefined}
          amountPaise={claimPaise ?? 0}
        />
      </ConfirmSheet>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Society UPI QR code')}</DialogTitle>
          </DialogHeader>
          {qr.data && (
            <img
              src={qr.data}
              alt={t('Society UPI QR code')}
              className="mx-auto w-full max-w-xs rounded-2xl border bg-white p-2"
            />
          )}
          <p className="mt-3 text-center font-semibold">{d.upi_id}</p>
          {qr.data && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button asChild variant="outline">
                <a href={qr.data} download="society-upi-qr" target="_blank" rel="noreferrer">
                  <Download /> {t('Save')}
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={qr.data} target="_blank" rel="noreferrer">
                  <ExternalLink /> {t('Open')}
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
