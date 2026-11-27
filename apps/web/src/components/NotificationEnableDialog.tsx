import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRing, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { enablePush, markPushBlocked, pushSupported } from '@/lib/push';
import { errorMessage } from '@/lib/supabase';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/**
 * Forced the moment someone opens the app and has never answered the browser's own notification
 * question (Notification.permission === 'default') -- gate approvals, dues, and now even the guard
 * salary urgent alert all depend on this, so it is not left to a dismissible card someone can scroll
 * past. No skip button: the only way out is tapping "Enable notifications", which opens the phone's
 * own permission prompt.
 *
 * Once the resident answers that OS prompt one way or the other, this dialog is done for good:
 *  - allowed  -> closes, device registered, never shown again.
 *  - blocked  -> we cannot reopen the native prompt again (a platform rule, not ours to lift), so this
 *    switches to a one-time "here's how to fix it in your phone settings" screen that CAN be closed --
 *    after that, the (dismissible, daily-reminding) banner on Home takes over the nagging.
 * Shown to every signed-in person (residents, guards, admins alike) -- everyone benefits from push, and
 * admins specifically need vehicle-approval/urgent alerts too.
 */
export function NotificationEnableDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [justBlocked, setJustBlocked] = useState(false);
  const [stuckReason, setStuckReason] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['pushPermission'],
    queryFn: () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'),
    staleTime: Infinity,
  });

  // Once blocked, status.data flips to 'denied' on the next refetch -- but we still need to show the
  // one-time "here's how to fix it" screen, so justBlocked keeps this open until the person dismisses it.
  if (!justBlocked && (!pushSupported() || status.data !== 'default')) return null;

  const enable = async () => {
    setBusy(true);
    setStuckReason(null);
    try {
      const r = await enablePush();
      void qc.invalidateQueries({ queryKey: ['pushPermission'] });
      if (r === 'granted') {
        toast.success(t('Notifications are on for this device'));
      } else if (r === 'denied') {
        markPushBlocked();
        setJustBlocked(true);
      }
    } catch (err) {
      // Show the real reason it stalled (e.g. "Timed out waiting for: push service
      // registration") instead of a generic message — that's the only way to tell what's
      // actually stuck (slow install vs. a network/firewall blocking Google's push service
      // vs. our own server) rather than guessing again next time.
      setStuckReason(errorMessage(err));
      toast.error(t('Could not turn on notifications. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent hideClose dismissible={justBlocked} className="sm:max-w-sm">
        <div className="pt-2 text-center">
          <span
            className={
              justBlocked
                ? 'mx-auto grid size-14 place-items-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                : 'mx-auto grid size-14 place-items-center rounded-full bg-primary/15 text-primary'
            }
          >
            {justBlocked ? <ShieldAlert className="size-7" /> : <BellRing className="size-7" />}
          </span>
          <DialogTitle className="mt-3 text-[20px] font-extrabold leading-tight">
            {justBlocked ? t('Notifications are blocked') : t('Turn on notifications')}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1.5 max-w-[34ch] text-[14px]">
            {justBlocked
              ? t(
                  'Your phone blocked the request. Open your browser/phone Settings → Notifications → allow Harmony Homes, then reopen the app.',
                )
              : t(
                  'Gate approvals, payment reminders and notices only reach you if notifications are on. Please allow it now.',
                )}
          </DialogDescription>
          {stuckReason && (
            <p className="mx-auto mt-2 max-w-[34ch] rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              {t('Stopped here')}: {stuckReason}
            </p>
          )}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {!justBlocked && (
            <Button size="xl" variant="hero" className="w-full" loading={busy} onClick={() => void enable()}>
              <BellRing /> {t('Enable notifications')}
            </Button>
          )}
          {justBlocked && (
            <Button size="xl" className="w-full" onClick={() => setJustBlocked(false) /* closes: status is no longer 'default' */}>
              {t('Got it')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
