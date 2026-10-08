import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { emailToUsername, passwordProblems } from '@harmony/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage, invokeFn } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const problems = passwordProblems(next, username, current);
  const rules = [
    { ok: next.length >= 8, label: t('At least 8 characters') },
    { ok: !!next && next.toLowerCase() !== username.toLowerCase(), label: t('Not your username') },
    { ok: !!next && next !== current, label: t('Different from the temporary password') },
    { ok: !!next && next === confirm, label: t('Both entries match') },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (problems.length || next !== confirm) return setError(t('Please fix the password rules below.'));
    setBusy(true);
    try {
      await invokeFn('account', { action: 'change_password', current_password: current, new_password: next });
      await refreshContext();
      toast.success(t('Password changed'));
      nav('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={forced ? t('Set your own password') : t('Change password')}
      subtitle={forced ? t('For your security, choose a new password before continuing.') : undefined}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="rounded-xl bg-secondary px-3 py-2 text-sm">
          {t('Username')}: <strong className="tabular">{username}</strong>
        </p>
        <Field label={forced ? t('Temporary password') : t('Current password')}>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label={t('New password')}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t('Confirm new password')}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
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
          <ShieldCheck /> {t('Save password')}
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
