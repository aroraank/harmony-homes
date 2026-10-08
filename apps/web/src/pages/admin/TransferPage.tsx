import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatINR, istToday, parseRupeesToPaise } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, newIdemKey, rpc } from '@/lib/supabase';
import { invalidateMoney, useDashboard, useFunds } from '@/lib/queries';
import { PageHeader } from '@/components/PageHeader';
import { Field } from '@/components/Field';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { EmptyState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AmountInput } from '@/components/AmountInput';
import { Input, NativeSelect } from '@/components/ui/input';

export default function TransferPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const funds = useFunds(m.societyId);
  const dash = useDashboard(m.societyId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(istToday());
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idem, setIdem] = useState(() => newIdemKey('trf'));

  if (!m.can('manage_events')) return <EmptyState title={t('You do not have permission to do this.')} />;
  const bal = (id: string) => dash.data?.funds.find((f) => f.id === id)?.balance_paise;
  const name = (id: string) => funds.data?.find((f) => f.id === id)?.name ?? '';
  const paise = parseRupeesToPaise(amount);

  const go = async () => {
    setBusy(true);
    try {
      await rpc('transfer_between_funds', { p_from_fund_id: from, p_to_fund_id: to, p_amount_paise: paise, p_entry_date: date, p_note: note, p_idempotency_key: idem });
      toast.success(t('Moved {{a}} from {{f}} to {{t}}', { a: formatINR(paise ?? 0), f: name(from), t: name(to) }));
      invalidateMoney(qc);
      setAmount('');
      setNote('');
      setConfirm(false);
      setIdem(newIdemKey('trf'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const valid = from && to && from !== to && paise && note.trim().length >= 3 && date <= istToday();
  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Move money between funds')} subtitle={t('The society total does not change')} back="/more" />
      <Card className="space-y-4 p-4">
        <Field label={t('From fund')} hint={from && bal(from) !== undefined ? t('Balance {{a}}', { a: formatINR(bal(from)!) }) : undefined}>
          <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {funds.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t('To fund')} hint={to && bal(to) !== undefined ? t('Balance {{a}}', { a: formatINR(bal(to)!) }) : undefined}>
          <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{t('Choose…')}</option>
            {funds.data?.filter((f) => f.id !== from).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Amount')}>
            <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular font-bold" />
          </Field>
          <Field label={t('Date')}>
            <Input type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Note')} hint={t('Required — explain why')}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        <Button size="lg" className="w-full" disabled={!valid} onClick={() => setConfirm(true)}>
          <ArrowLeftRight /> {t('Review transfer')}
        </Button>
      </Card>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Move this money?')}
        rows={[
          { label: t('From'), value: name(from) },
          { label: t('To'), value: name(to) },
          { label: t('Amount'), value: formatINR(paise ?? 0), strong: true },
          { label: t('Date'), value: formatDate(date) },
          { label: t('Note'), value: note },
        ]}
        confirmLabel={t('Move money')}
        loading={busy}
        onConfirm={go}
      />
    </div>
  );
}
