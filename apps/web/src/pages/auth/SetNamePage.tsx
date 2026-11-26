import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { Alert } from '@/components/ui/alert';
import { Splash } from '@/components/Splash';
import { AuthLayout } from './AuthLayout';

/** Forced once per flat login, until a real first + last name is entered -- no skip, no close button.
 *  Admins/super-admins are exempt (see App.tsx), same as the vehicle-registration popups. */
export default function SetNamePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const { session, loading, ctx, refreshContext } = useAuth();
  const m = useMember();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  if (ctx?.profile?.name_set) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const nameRe = /^[A-Za-z][A-Za-z.']{1,29}$/;
  const validFirst = nameRe.test(first.trim());
  const validLast = nameRe.test(last.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validFirst || !validLast) {
      setError(t('Please enter a valid first and last name (letters only).'));
      return;
    }
    setBusy(true);
    try {
      await rpc('update_my_profile', {
        p_full_name: `${first.trim()} ${last.trim()}`,
        p_phone: ctx?.profile?.phone ?? null,
        p_locale: ctx?.profile?.locale ?? null,
      });
      await refreshContext();
      toast.success(t('Name saved'));
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('What is your name?')} subtitle={t('So the rest of {{unit}} knows who this is.', { unit: m.unit_code ?? m.unit_name ?? 'your flat' })}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('First name')}>
          <Input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus maxLength={30} />
        </Field>
        <Field label={t('Last name')}>
          <Input value={last} onChange={(e) => setLast(e.target.value)} maxLength={30} />
        </Field>
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" size="xl" variant="hero" className="w-full" loading={busy}>
          <UserCheck /> {t('Save and continue')}
        </Button>
      </form>
    </AuthLayout>
  );
}
