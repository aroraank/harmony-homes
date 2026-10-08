import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatDateTime, formatINR, istToday, paiseToInput, parseRupeesToPaise, relativeAge } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { AppError, errorMessage, rpc, supabase } from '@/lib/supabase';
import { invalidateMoney, unwrap, useFunds } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { MODE_LABELS } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { AttachmentButton } from '@/components/AttachmentButton';
import { Field } from '@/components/Field';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AmountInput } from '@/components/AmountInput';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Claim } from '@/types';

type ClaimRow = Claim & { units: { code: string } | null; funds: { name: string } | null; profiles: { full_name: string } | null; due_labels?: string[] };

export default function ClaimsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const [tab, setTab] = useState('pending');
  const q = useQuery({
    queryKey: ['claims', 'admin', m.societyId, tab],
    queryFn: async () => {
      let qb = supabase
        .from('payment_claims')
        .select('*, units(code), funds(name), profiles!payment_claims_submitted_by_fkey(full_name)')
        .eq('society_id', m.societyId);
      qb = tab === 'pending' ? qb.eq('status', 'pending').order('created_at') : qb.neq('status', 'pending').order('reviewed_at', { ascending: false }).limit(50);
      const rows = unwrap<ClaimRow[]>(await qb);
      // months the member said this payment is for
      const ids = [...new Set(rows.flatMap((r) => (r as { due_ids?: string[] | null }).due_ids ?? []))];
      if (ids.length) {
        const labels = new Map((unwrap<{ id: string; label: string }[]>(await supabase.from('v_dues').select('id, label').in('id', ids))).map((x) => [x.id, x.label]));
        for (const r of rows) r.due_labels = ((r as { due_ids?: string[] | null }).due_ids ?? []).map((i) => labels.get(i) ?? '').filter(Boolean);
      }
      return rows;
    },
  });
  const [approve, setApprove] = useState<ClaimRow | null>(null);
  const [reject, setReject] = useState<ClaimRow | null>(null);

  if (!m.can('approve_claims')) return <EmptyState title={t('You do not have permission to do this.')} />;

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Payment claims')} subtitle={t('Check the bank / UPI app, then approve to issue a receipt')} back />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pending">{t('Pending')}</TabsTrigger>
          <TabsTrigger value="reviewed">{t('Reviewed')}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          <QueryState
            query={q}
            empty={(d) => (d.length ? null : <EmptyState icon={<BadgeCheck className="size-7" />} title={tab === 'pending' ? t('No claims waiting') : t('Nothing reviewed yet')} />)}
          >
            {(rows) => (
              <div className="space-y-2.5">
                {rows.map((c) => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-semibold text-muted-foreground">
                          <span className="tabular text-foreground">{c.units?.code}</span> · {c.profiles?.full_name} · {relativeAge(c.created_at)}
                        </p>
                        <Money paise={c.amount_paise} className="text-2xl font-extrabold" />
                        <p className="text-[12.5px] text-muted-foreground">
                          {c.funds?.name} · {formatDate(c.paid_on)} · {MODE_LABELS[c.payment_mode] ?? c.payment_mode}
                        </p>
                        {c.due_labels && c.due_labels.length > 0 && (
                          <p className="mt-1 text-[13px] font-semibold text-primary">{t('For')}: {c.due_labels.join(', ')}</p>
                        )}
                        {c.reference_no && (
                          <p className="tabular mt-1 select-all text-sm font-bold tracking-wide">
                            UTR {c.reference_no}
                          </p>
                        )}
                        {c.note && <p className="mt-1 text-[13px]">“{c.note}”</p>}
                      </div>
                      {c.status !== 'pending' && <Badge variant={c.status === 'approved' ? 'success' : 'danger'}>{c.status === 'approved' ? t('Approved') : t('Rejected')}</Badge>}
                    </div>
                    {c.reject_reason && <p className="mt-2 text-[13px] text-muted-foreground">{t('Reason')}: {c.reject_reason}</p>}
                    {c.reviewed_at && <p className="mt-1 text-[12px] text-muted-foreground">{t('Reviewed')} {formatDateTime(c.reviewed_at)}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.screenshot_path && <AttachmentButton path={c.screenshot_path} label={t('Screenshot')} />}
                      {c.status === 'pending' && (
                        <>
                          <Button size="sm" onClick={() => setApprove(c)}>
                            <Check /> {t('Approve')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setReject(c)}>
                            <X /> {t('Reject')}
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </QueryState>
        </TabsContent>
      </Tabs>
      {approve && <ApproveSheet claim={approve} onClose={() => setApprove(null)} />}
      {reject && <RejectSheet claim={reject} onClose={() => setReject(null)} />}
    </div>
  );
}

function ApproveSheet({ claim, onClose }: { claim: ClaimRow; onClose: () => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const funds = useFunds(m.societyId);
  const [amount, setAmount] = useState(paiseToInput(claim.amount_paise));
  const [fundId, setFundId] = useState(claim.fund_id);
  const [date, setDate] = useState(claim.paid_on);
  const [dup, setDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const paise = parseRupeesToPaise(amount);

  const go = async () => {
    if (!paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    setBusy(true);
    try {
      const r = await rpc<{ receipt_no: string }>('approve_claim', {
        p_claim_id: claim.id,
        p_amount_paise: paise === claim.amount_paise ? null : paise,
        p_fund_id: fundId === claim.fund_id ? null : fundId,
        p_entry_date: date === claim.paid_on ? null : date,
        p_allow_duplicate_reference: dup,
      });
      invalidateMoney(qc);
      nudgePush();
      toast.success(t('Approved — receipt {{r}} sent to the member', { r: r.receipt_no }));
      onClose();
    } catch (e) {
      if (e instanceof AppError && e.isDuplicateReference && !dup) {
        setDup(true);
        toast.warning(t('This UTR is already in the ledger. Tap approve again only if it is a different payment.'));
      } else toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Approve payment claim')}</DialogTitle>
          <DialogDescription>{t('Only approve after you see this money in the society account. A receipt is issued immediately.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('Verified amount')} hint={paise !== claim.amount_paise ? t('Member claimed {{a}}', { a: formatINR(claim.amount_paise) }) : undefined}>
            <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular text-lg font-bold" />
          </Field>
          <Field label={t('Fund')}>
            <NativeSelect value={fundId} onChange={(e) => setFundId(e.target.value)}>
              {(funds.data ?? []).filter((f) => f.is_active).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('Date received')} hint={t('Change only if the month is closed or the date is wrong')}>
            <Input type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {dup && <Alert variant="warning">{t('Duplicate UTR — approving again will record it anyway.')}</Alert>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button onClick={go} loading={busy} variant={dup ? 'destructive' : 'default'}>
            <Check /> {dup ? t('Approve anyway') : t('Approve and issue receipt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectSheet({ claim, onClose }: { claim: ClaimRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await rpc('reject_claim', { p_claim_id: claim.id, p_reason: reason });
      void qc.invalidateQueries({ queryKey: ['claims'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      nudgePush();
      toast.success(t('Claim rejected — the member was told why'));
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
          <DialogTitle>{t('Reject claim')}</DialogTitle>
          <DialogDescription>
            {claim.units?.code} · {formatINR(claim.amount_paise)}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('Reason (sent to the member)')}>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={t('e.g. No payment with this UTR found in the account')} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" onClick={go} loading={busy} disabled={reason.trim().length < 3}>
            {t('Reject')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
