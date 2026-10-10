import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download } from 'lucide-react';
import { useInstallPrompt } from '@/lib/install';
import { isIOS, isIOSNonSafari, isStandalone } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Always-rendered install guidance — never hidden or dismissible, so it's guaranteed to show on
 * both the Home page and the Profile page. Renders the right thing for every situation: the real
 * browser install button when available (Android/desktop Chrome), platform-specific manual steps
 * on iOS (Safari vs. Chrome/other — see isIOSNonSafari), or a generic fallback, and a simple
 * confirmation once the app is already installed on this device.
 */
export function InstallHelp() {
  const { t } = useTranslation();
  const install = useInstallPrompt();

  if (isStandalone())
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-primary" />
        {t('The app is already installed on this device.')}
      </p>
    );

  if (install.available)
    return (
      <Button className="w-full" onClick={() => void install.install()}>
        <Download /> {t('Install app')}
      </Button>
    );

  if (isIOSNonSafari())
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          'On iPhone, please install from Safari: tap ⋯ or the address bar, choose "Open in Safari", then tap Share → "Add to Home Screen". Chrome on iPhone cannot install apps — this is an Apple restriction.',
        )}
      </p>
    );

  if (isIOS())
    return (
      <p className="text-sm text-muted-foreground">{t('On iPhone: tap Share, then "Add to Home Screen".')}</p>
    );

  return (
    <p className="text-sm text-muted-foreground">
      {t('Open your browser menu and choose "Install app" or "Add to Home Screen".')}
    </p>
  );
}
