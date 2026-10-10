import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { formatINR } from '@harmony/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Dashboard } from '@/types';

/**
 * A vibrant reminder shown to a member (on their own flat) whenever they have a pending balance
 * that they have not yet acknowledged for its current amount. Tapping OK records the acknowledgement
 * and notifies admins/super admins that the resident is aware of it (does not mark it paid). The
 * header and action buttons stay pinned, and the content is kept short so the whole card fits a
 * mobile screen with no internal scrolling.
 */
export function PendingPaymentDialog({ dash }: { dash: Dashboard }) {
  const { t } = useTranslation();
  const { ctx } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const unitId = dash.mine?.unit_id ?? null;
  const pending = dash.mine?.pending_paise ?? 0;
  // Only after the member has been through the one-time welcome popup, so the two never overlap.
  const welcomed = !!ctx?.profile?.welcomed_at;

  const lastAck = useQuery({
    queryKey: ['paymentAck', unitId],
    enabled: !!unitId && welcomed && pending > 0,
    queryFn: async () =>
      unwrap<{ pending_paise: number }[]>(
        await supabase
          .from('payment_acks')
          .select('pending_paise')
          .eq('unit_id', unitId)
          .order('acknowledged_at', { ascending: false })
          .limit(1),
      ),
  });

  const open =
    !dismissed &&
    welcomed &&
    !!unitId &&
    pending > 0 &&
    !!lastAck.data &&
    lastAck.data[0]?.pending_paise !== pending;

  const close = async () => {
    if (!unitId) return;
    setBusy(true);
    setDismissed(true);
    try {
      await rpc('acknowledge_pending_payment', { p_unit_id: unitId, p_pending_paise: pending });
      void qc.invalidateQueries({ queryKey: ['paymentAck', unitId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent dismissible={false} hideClose className="flex flex-col p-0">
        <div className="-mx-5 -mt-3 sticky top-[-0.75rem] z-10 shrink-0 bg-gradient-to-br from-rose-600 via-red-600 to-orange-500 px-5 pb-4 pt-5 text-center text-white">
          <span className="mx-auto grid size-10 place-items-center rounded-full bg-white/20">
            <AlertTriangle className="size-5" />
          </span>
          <DialogHeader className="mb-0 mt-1.5">
            <DialogTitle className="text-base font-extrabold text-white">
              {t('You have a pending payment')}
            </DialogTitle>
          </DialogHeader>
          <p className="tabular mt-1 text-2xl font-extrabold">{formatINR(pending)}</p>
          <p className="mt-0.5 text-[12px] text-white/90">
            {t('for {{u}}', { u: dash.mine?.unit_code ?? '' })}
          </p>
        </div>

        <div className="py-2.5">
          <p className="text-[12px] leading-snug text-muted-foreground">
            {t(
              'Please clear this soon. Tapping OK only confirms you have seen it — it does not mark it as paid.',
            )}
          </p>
        </div>

        <div className="sticky bottom-[-1.25rem] -mx-5 -mb-5 flex shrink-0 gap-2 border-t bg-card px-5 pb-5 pt-2.5">
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => {
              setDismissed(true);
              nav('/pay');
            }}
          >
            <IndianRupee /> {t('Pay now')}
          </Button>
          <Button className="flex-1" disabled={busy} onClick={() => void close()}>
            {t('OK, got it')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
