import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatINR, parseRupeesToPaise, periodLabel } from '@harmony/shared';
import { errorMessage } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Field } from '@/components/Field';
import { AmountInput } from '@/components/AmountInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type AmountMode = 'now' | 'next';

/** Change an amount for the current month ("now") or only from next month. Earlier months are never touched. */
export function ChangeAmountDialog({
  open,
  onClose,
  title,
  currentPaise,
  currentPeriod,
  nextPeriod,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  currentPaise: number;
  currentPeriod: string;
  nextPeriod: string;
  onSubmit: (paise: number, mode: AmountMode, reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<AmountMode>('next');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const paise = parseRupeesToPaise(amount);
    if (!paise) return toast.error(t('Enter an amount like 800 or 800.50'));
    if (reason.trim().length < 3) return toast.error(t('Give a short reason — everyone will see it.'));
    setBusy(true);
    try {
      await onSubmit(paise, mode, reason.trim());
      setAmount('');
      setReason('');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const opt = (m: AmountMode, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cn('w-full cursor-pointer rounded-xl border p-3 text-left', mode === m ? 'border-primary bg-primary/10' : 'bg-card')}
      aria-pressed={mode === m}
    >
      <p className="text-sm font-bold">{label}</p>
      <p className="text-[12.5px] text-muted-foreground">{hint}</p>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Change amount')}</DialogTitle>
          <DialogDescription>
            {title} · {t('now {{a}}', { a: formatINR(currentPaise) })}. {t('Earlier months are never changed.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={t('New amount')}>
            <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="17500" />
          </Field>
          <div className="space-y-2">
            {opt('next', t('From next month ({{m}})', { m: periodLabel(nextPeriod) }), t('This month stays as it is.'))}
            {opt('now', t('From this month ({{m}})', { m: periodLabel(currentPeriod) }), t('Updates this month too. Not possible once someone has paid.'))}
          </div>
          <Field label={t('Reason')} hint={t('Everyone is notified and can read this.')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('Salary revised')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('Save and notify everyone')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
