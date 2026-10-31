import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth, useMember } from '@/lib/auth';

/** Stop the campaign automatically — after this date the toast never fires again. */
const CAMPAIGN_ENDS = new Date('2026-12-31T23:59:59+05:30').getTime();

/**
 * A short, warm "Namaste, welcome back" toast on every app open, for a limited launch-window
 * campaign (through end of Dec 2026) rather than a once-per-gap nudge. Fires once per app
 * session (this component mounts once, at the AppShell root) — not on every page navigation
 * inside the app. Never competes with WelcomeDialog, which only ever fires once, on a brand-new
 * member's very first login.
 */
export function WelcomeBackToast() {
  const { t } = useTranslation();
  const { ctx } = useAuth();
  const m = useMember();
  const welcomed = !!ctx?.profile?.welcomed_at;

  useEffect(() => {
    if (!welcomed || Date.now() > CAMPAIGN_ENDS) return;
    toast(t('Namaste, {{n}}! 🙏', { n: m.fullName }), {
      description: t('Welcome back — good to see you again.'),
      duration: 5000,
    });
    // Runs once per app session (this component mounts once, at the shell root).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welcomed]);

  return null;
}
