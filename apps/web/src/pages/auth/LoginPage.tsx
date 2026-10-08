import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, KeyRound, LogIn, Building2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { usernameToEmail } from '@harmony/shared';
import { useAuth } from '@/lib/auth';
import { DEFAULT_SOCIETY_SLUG, supabase } from '@/lib/supabase';
import { getLocal, setLocal } from '@/lib/storage';
import { setLanguage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AuthLayout } from './AuthLayout';

const LOCK_KEY = 'hh-login-lock';
const MAX_TRIES = 5;

export default function LoginPage() {
  const { t, i18n } = useTranslation();
  const { session, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [slug, setSlug] = useState(() => getLocal('hh-slug') || DEFAULT_SOCIETY_SLUG);
  const [editSlug, setEditSlug] = useState(!slug);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [forgot, setForgot] = useState(false);
  const [forgotUser, setForgotUser] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  const lock = useMemo(() => {
    try {
      return JSON.parse(getLocal(LOCK_KEY) || '{"n":0,"until":0}') as { n: number; until: number };
    } catch {
      return { n: 0, until: 0 };
    }
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const lockedFor = Math.max(0, Math.ceil((lock.until - now) / 1000));

  useEffect(() => {
    if (!lockedFor) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedFor]);

  const society = useQuery({
    queryKey: ['societyPublic', slug],
    enabled: slug.length >= 2,
    staleTime: 3600_000,
    queryFn: async () => {
      const { data } = await supabase.rpc('society_public', { p_slug: slug.trim().toLowerCase() });
      return (data as { id: string; name: string; slug: string } | null) ?? null;
    },
  });

  if (!loading && session) return <Navigate to={loc.state?.from ?? '/'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (lockedFor) return;
    const s = slug.trim().toLowerCase();
    if (!s) return setError(t('Enter your society code.'));
    if (!username.trim() || !password) return setError(t('Enter your username and PIN.'));
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: usernameToEmail(username, s), password });
    setBusy(false);
    if (err) {
      const n = lock.n + 1;
      const until = n >= MAX_TRIES ? Date.now() + 60_000 : 0;
      setLocal(LOCK_KEY, JSON.stringify({ n: n >= MAX_TRIES ? 0 : n, until }));
      setNow(Date.now());
      void supabase.rpc('report_failed_login', { p_slug: s, p_username: username.trim() });
      setError(
        /fetch|network/i.test(err.message)
          ? t("Can't reach the server. Check your internet connection.")
          : /rate|too many/i.test(err.message)
            ? t('Too many attempts. Please wait a minute and try again.')
            : t('Wrong username or PIN.'),
      );
      return;
    }
    setLocal(LOCK_KEY, null);
    setLocal('hh-slug', s);
    nav(loc.state?.from ?? '/', { replace: true });
  };

  return (
    <AuthLayout title={t('Welcome home')} subtitle={t('Sign in with your flat code, e.g. P1-GF')} society={society.data?.name}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {editSlug ? (
          <Field label={t('Society code')} hint={society.data ? society.data.name : slug.length >= 2 && !society.isLoading ? t('Society not found') : t('Given by your committee')}>
            <Input value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="plot-colony" />
          </Field>
        ) : (
          <button
            type="button"
            onClick={() => setEditSlug(true)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-xl bg-secondary px-3 py-2.5 text-left text-sm"
          >
            <Building2 className="size-4 text-primary" />
            <span className="flex-1 truncate font-semibold">{society.data?.name ?? slug}</span>
            <span className="text-xs font-semibold text-primary">{t('Change')}</span>
          </button>
        )}
        <Field label={t('Username')} hint={t('Your flat code (for example P3-FF) or staff username')}>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value.toUpperCase())}
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="P1-GF"
            inputMode="text"
          />
        </Field>
        <Field label={t('PIN')}>
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              inputMode="numeric"
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="tabular pr-12 tracking-[0.2em]"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
              aria-label={show ? t('Hide PIN') : t('Show PIN')}
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </Field>
        {error && <Alert variant="danger">{error}</Alert>}
        {lockedFor > 0 && <Alert variant="warning">{t('Too many wrong attempts. Try again in {{s}} seconds.', { s: lockedFor })}</Alert>}
        <Button type="submit" size="xl" variant="hero" className="w-full" loading={busy} disabled={lockedFor > 0}>
          <LogIn /> {t('Sign in')}
        </Button>
        <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          {t('Never share your PIN with anyone.')}
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            setForgotUser(username);
            setForgot(true);
          }}
        >
          {t('Forgot PIN? Ask the admin')}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between border-t pt-4 text-sm">
        <Link to="/register" className="font-semibold text-primary hover:underline">
          {t('New resident? Register')}
        </Link>
        <button
          type="button"
          className="cursor-pointer font-semibold text-muted-foreground hover:text-foreground"
          style={{ fontFamily: 'system-ui, sans-serif' }}
          onClick={() => {
            setLanguage(i18n.language === 'hi' ? 'en' : 'hi');
            try {
              window.sessionStorage.setItem('hh-lang-picked', '1');
            } catch {
              /* ignore */
            }
          }}
        >
          {i18n.language === 'hi' ? 'English' : 'हिन्दी'}
        </button>
      </div>
      <Dialog open={forgot} onOpenChange={(o) => !forgotBusy && setForgot(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Forgot your PIN?')}</DialogTitle>
            <DialogDescription>
              {t('Enter your flat code. The admin and super admin are told, set a new PIN for you and give it to you personally.')}
            </DialogDescription>
          </DialogHeader>
          <Field label={t('Username')}>
            <Input
              value={forgotUser}
              onChange={(e) => setForgotUser(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              maxLength={40}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="P1-GF"
            />
          </Field>
          <Button
            size="lg"
            className="w-full"
            loading={forgotBusy}
            disabled={forgotUser.trim().length < 2}
            onClick={async () => {
              setForgotBusy(true);
              await supabase.rpc('request_pin_reset', { p_slug: slug.trim().toLowerCase(), p_username: forgotUser.trim() });
              setForgotBusy(false);
              setForgot(false);
              toast.success(t('Request sent. The admin will give you a new PIN.'));
            }}
          >
            <Send /> {t('Send request to admin')}
          </Button>
        </DialogContent>
      </Dialog>
    </AuthLayout>
  );
}
