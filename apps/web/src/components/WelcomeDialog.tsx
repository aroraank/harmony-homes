import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

/**
 * Shown exactly once, right after a member finishes setting their own PIN for the first time
 * (profiles.welcomed_at is null until then). Every role sees it — admins and super admins get an
 * extra, compact line on their responsibilities. Content is intentionally short so the whole card
 * fits a mobile screen with no internal scrolling at all.
 */
export function WelcomeDialog() {
  const { t } = useTranslation();
  const { ctx, refreshContext } = useAuth();
  const m = useMember();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = !dismissed && !!ctx?.profile && !ctx.profile.must_change_password && !ctx.profile.welcomed_at;

  const close = async () => {
    setBusy(true);
    setDismissed(true);
    try {
      await rpc('mark_welcomed', {});
      void refreshContext();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const perks = [
    t('Pay dues online'),
    t('See notices & agendas'),
    t('Raise a concern'),
    t('Find trusted contacts'),
  ];
  const duties = m.isSuperAdmin
    ? t('Confirm payments, follow up on dues, respond to concerns, and manage member & admin records.')
    : t('Confirm payments and expenses, follow up on dues, and respond to concerns promptly.');

  return (
    <Dialog open={open}>
      <DialogContent dismissible={false} hideClose className="flex flex-col p-0">
        <div className="-mx-5 -mt-3 sticky top-[-0.75rem] z-10 shrink-0 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-5 pb-4 pt-5 text-center text-white">
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-white/15 text-2xl">
            🙏
          </span>
          <DialogHeader className="mb-0 mt-1.5">
            <DialogTitle className="text-lg font-extrabold text-white">
              {t('Namaste, {{n}}!', { n: m.fullName })}
            </DialogTitle>
          </DialogHeader>
          <p className="mt-0.5 text-[12.5px] text-white/90">{t('Welcome to Harmony Homes Zirakpur 🎉')}</p>
        </div>

        <div className="space-y-2.5 pb-2 pt-3">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            {perks.map((x) => (
              <div key={x} className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-[14px] shrink-0 text-primary" />
                <span className="text-[12px] leading-tight">{x}</span>
              </div>
            ))}
          </div>
          {m.isAdmin && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-900 dark:text-amber-200">
                <ShieldCheck className="mt-0.5 size-[13px] shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <span className="font-bold uppercase tracking-wide">{t('As admin:')}</span> {duties}
                </span>
              </p>
            </div>
          )}
        </div>

        <div className="sticky bottom-[-1.25rem] -mx-5 -mb-5 shrink-0 border-t bg-card px-5 pb-5 pt-2.5">
          <Button className="w-full" size="lg" disabled={busy} onClick={() => void close()}>
            {t("Let's go")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
