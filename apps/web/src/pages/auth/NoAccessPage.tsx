import { useTranslation } from 'react-i18next';
import { Hourglass, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { AuthLayout } from './AuthLayout';

export default function NoAccessPage() {
  const { t } = useTranslation();
  const { ctx, signOut, refreshContext } = useAuth();
  const pending = (ctx?.memberships ?? []).some((m) => m.status === 'pending');
  return (
    <AuthLayout title={pending ? t('Waiting for approval') : t('No access')}>
      <div className="flex flex-col items-center text-center">
        <Hourglass className="size-12 text-primary" />
        <p className="mt-3 font-semibold">
          {pending ? t('Your registration is waiting for the admin to approve it.') : t('This account is not active in any society.')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t('Contact your society committee if this looks wrong.')}</p>
        <Button className="mt-5 w-full" variant="outline" onClick={() => void refreshContext()}>
          {t('Check again')}
        </Button>
        <Button className="mt-2 w-full" variant="ghost" onClick={() => void signOut()}>
          <LogOut /> {t('Sign out')}
        </Button>
      </div>
    </AuthLayout>
  );
}
