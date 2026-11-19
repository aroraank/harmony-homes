import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Megaphone, Siren } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@harmony/shared';
import { errorMessage, rpc } from '@/lib/supabase';
import type { PendingFixed } from '@/lib/fixedExpenses';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/**
 * "Can't pay yet": lets an admin tell every member that the payment could not be made, with a reason,
 * and (when the society balance really is too low) send the red urgent alert asking everyone to pay up.
 */
export function PaymentBlockedDialog({
  item,
  open,
  onOpenChange,
}: {
  item: PendingFixed;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'urgent' | 'blocked' | null>(null);

  const done = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['pendingFixed'] });
  };
  const urgent = async () => {
    setBusy('urgent');
    try {
      await rpc('send_low_balance_alert', { p_draft_id: item.draft_id });
      toast.success(t('Urgent alert sent to everyone.'));
      done();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const blocked = async () => {
    if (reason.trim().length < 5) return toast.error(t('Please give a reason (at least 5 characters).'));
    setBusy('blocked');
    try {
      await rpc('report_payment_blocked', { p_draft_id: item.draft_id, p_reason: reason });
      toast.success(t('Everyone has been told.'));
      setReason('');
      done();
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="text-[18px] font-extrabold leading-snug">
          {t('{{title}} — {{month}}', { title: item.title, month: item.period_label })}
        </DialogTitle>
        <DialogDescription className="text-[14px] leading-relaxed text-foreground">
          {t('Society balance {{b}}, needed {{a}}.', {
            b: formatINR(item.balance_paise),
            a: formatINR(item.amount_paise),
          })}{' '}
          {item.shortfall_paise > 0
            ? t('Still short by {{s}}.', { s: formatINR(item.shortfall_paise) })
            : t('The balance covers this payment.')}
        </DialogDescription>

        {item.shortfall_paise > 0 && (
          <div className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-3.5 dark:border-rose-500/40 dark:bg-rose-500/10">
            <p className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-200">
              <Siren className="size-5" /> {t('Urgent alert to all members')}
            </p>
            <p className="mt-1 text-[13px] text-rose-900/80 dark:text-rose-100/80">
              {t('Tells everyone the balance is still too low and asks them to pay urgently, otherwise we may lose the security guard. Can be sent once a day.')}
            </p>
            <Button
              variant="destructive"
              className="mt-2.5 w-full"
              loading={busy === 'urgent'}
              onClick={() => void urgent()}
            >
              {t('Send urgent alert')}
            </Button>
          </div>
        )}

        <div className="rounded-2xl border bg-card p-3.5">
          <p className="flex items-center gap-2 font-bold">
            <Megaphone className="size-5 text-primary" /> {t('I cannot pay yet')}
          </p>
          {item.can_report_blocked ? (
            <>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('Everyone is told that the payment could not be made, with your reason. It stays on your list until it is paid.')}
              </p>
              <Textarea
                className="mt-2"
                rows={3}
                maxLength={250}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('Reason, e.g. not enough money collected yet')}
              />
              <Button
                variant="outline"
                className="mt-2.5 w-full"
                loading={busy === 'blocked'}
                onClick={() => void blocked()}
              >
                {t('Tell everyone it could not be paid yet')}
              </Button>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t('This option opens on the 10th of the month. Until then, please try to arrange the payment.')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
