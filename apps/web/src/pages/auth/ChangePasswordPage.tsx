import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { emailToUsername, pinProblems } from '@harmony/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage, invokeFn } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { PinInput } from '@/components/PinInput';
import { Field } from '@/components/Field';
import { Alert } from '@/components/ui/alert';
import { Splash } from '@/components/Splash';
import { AuthLayout } from './AuthLayout';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { session, loading, ctx, refreshContext, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  const forced = !!ctx?.profile?.must_change_password;
  const username = emailToUsername(session.user.email ?? '');
  const problems = pinProblems(next, current);
  const rules = [
    { ok: /^\d+$/.test(next), label: t('Numbers only') },
    { ok: next.length === 6, label: t('Exactly 6 digits') },
    { ok: !!next && next !== current, label: forced ? t('Different from the temporary PIN') : t('Different from the current PIN') },
    { ok: !!next && next === confirm, label: t('Both entries match') },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (problems.length || next !== confirm) return setError(t('Please fix the PIN rules below.'));
    setBusy(true);
    try {
      await invokeFn('account', { action: 'change_password', current_password: current, new_password: next });
      await refreshContext();
      toast.success(t('PIN changed'));
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={forced ? t('Set your own PIN') : t('Change PIN')}
      subtitle={forced ? t('Choose a PIN of 6 or more digits. You will use it every time you sign in.') : undefined}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="rounded-xl bg-secondary px-3 py-2 text-sm">
          {t('Username')}: <strong className="tabular">{username}</strong>
        </p>
        <Field label={forced ? t('Temporary PIN (given to you)') : t('Current PIN')}>
          <PinInput anyCharacters autoComplete="current-password" value={current} onChange={setCurrent} />
        </Field>
        <Field label={t('New PIN')}>
          <PinInput defaultShown value={next} onChange={setNext} />
        </Field>
        <Field label={t('Confirm new PIN')}>
          <PinInput defaultShown value={confirm} onChange={setConfirm} />
        </Field>
        <ul className="space-y-1.5 text-[13px]">
          {rules.map((r) => (
            <li key={r.label} className={r.ok ? 'flex items-center gap-2 text-credit' : 'flex items-center gap-2 text-muted-foreground'}>
              {r.ok ? <Check className="size-4" /> : <X className="size-4" />} {r.label}
            </li>
          ))}
        </ul>
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" size="xl" variant="hero" className="w-full" loading={busy}>
          <ShieldCheck /> {t('Save PIN')}
        </Button>
        {forced ? (
          <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
            {t('Sign out')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" className="w-full" onClick={() => nav(-1)}>
            {t('Cancel')}
          </Button>
        )}
      </form>
    </AuthLayout>
  );
}
