import { PhoneInput } from '@/components/PhoneInput';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BellOff,
  BellRing,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, mobileSchema, personNameSchema } from '@harmony/shared';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { setLanguage } from '@/lib/i18n';
import { useTheme, type ThemePref } from '@/lib/theme';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';
import { cn, deviceLabel, isIOS, isStandalone } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { InstallHelp } from '@/components/InstallHelp';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';

type Session = {
  id: string;
  created_at: string;
  last_active: string;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
};

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const m = useMember();
  const { ctx, refreshContext, signOut } = useAuth();
  const qc = useQueryClient();
  const theme = useTheme();
  const [name, setName] = useState(ctx?.profile?.full_name ?? '');
  const [phone, setPhone] = useState(ctx?.profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void currentSubscription().then((s) =>
      setPushOn(!!s && typeof Notification !== 'undefined' && Notification.permission === 'granted'),
    );
  }, []);

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => rpc<Session[]>('my_sessions') });

  const saveProfile = async () => {
    const n = personNameSchema.safeParse(name);
    if (!n.success) return toast.error(t(n.error.issues[0]?.message ?? 'Invalid name'));
    let p: string | null = null;
    if (phone.trim()) {
      const r = mobileSchema.safeParse(phone);
      if (!r.success) return toast.error(t('Enter a valid 10-digit Indian mobile number'));
      p = r.data;
    }
    setSaving(true);
    try {
      await rpc('update_my_profile', {
        p_full_name: n.data,
        p_phone: p,
        p_locale: i18n.language === 'hi' ? 'hi' : 'en',
      });
      await refreshContext();
      toast.success(t('Profile saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changeLang = async (lng: 'en' | 'hi') => {
    setLanguage(lng);
    try {
      await rpc('set_my_locale', { p_locale: lng });
    } catch {
      /* language still changes locally */
    }
  };

  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) {
        const r = await enablePush();
        if (r === 'granted') {
          setPushOn(true);
          toast.success(t('Notifications are on for this device'));
        } else if (r === 'denied')
          toast.error(t('Notifications were blocked. You can allow them in your browser settings.'));
        else toast.error(t('This browser does not support push notifications.'));
      } else {
        await disablePush();
        setPushOn(false);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPushBusy(false);
    }
  };

  const signOutOthers = async () => {
    try {
      const n = await rpc<number>('sign_out_other_sessions');
      toast.success(t('Signed out {{n}} other device(s)', { n }));
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const signOutOne = async (id: string) => {
    try {
      await rpc('sign_out_session', { p_session_id: id });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const themes: { k: ThemePref; label: string; Icon: typeof Sun }[] = [
    { k: 'light', label: t('Light'), Icon: Sun },
    { k: 'dark', label: t('Dark'), Icon: Moon },
    { k: 'system', label: t('Auto'), Icon: Monitor },
  ];

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Profile')} back="/more" />
      <Card className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          {t('Username')}:{' '}
          <strong className="tabular text-foreground">{(ctx?.profile && m.unit_code) || '—'}</strong>
          {m.unit_name ? ` · ${m.unit_name}` : ''}
        </p>
        <Field label={t('Full name')}>
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label={t('Mobile number')} optional hint={t('Visible only to admins')}>
          <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Button onClick={saveProfile} loading={saving}>
          {t('Save profile')}
        </Button>
      </Card>

      <SectionTitle>{t('App')}</SectionTitle>
      <Card className="p-4">
        <InstallHelp />
      </Card>

      <SectionTitle>{t('Language')}</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['en', 'English'],
            ['hi', 'हिन्दी'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => void changeLang(k)}
            className={cn(
              'min-h-12 cursor-pointer rounded-2xl border font-semibold',
              i18n.language === k
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-secondary',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <SectionTitle>{t('Appearance')}</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        {themes.map(({ k, label, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => theme.setPref(k)}
            className={cn(
              'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border text-sm font-semibold',
              theme.pref === k
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-secondary',
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <SectionTitle>{t('Notifications')}</SectionTitle>
      <Card className="p-4">
        {pushSupported() ? (
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              {pushOn ? (
                <BellRing className="size-5 text-primary" />
              ) : (
                <BellOff className="size-5 text-muted-foreground" />
              )}
              <span>
                <span className="block text-sm font-semibold">{t('Push notifications on this device')}</span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {t('Notices, receipts and replies')}
                </span>
              </span>
            </span>
            <Switch
              checked={!!pushOn}
              disabled={pushBusy || pushOn === null}
              onCheckedChange={(v) => void togglePush(v)}
            />
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isIOS() && !isStandalone()
              ? t(
                  'On iPhone, add Harmony to your Home Screen first (Share → Add to Home Screen), then open it from there to allow notifications.',
                )
              : t('This browser does not support push notifications.')}
          </p>
        )}
      </Card>

      <SectionTitle
        action={
          (sessions.data?.length ?? 0) > 1 && (
            <Button variant="link" size="sm" onClick={signOutOthers}>
              {t('Sign out others')}
            </Button>
          )
        }
      >
        {t('Active devices')}
      </SectionTitle>
      <Card className="divide-y">
        {(sessions.data ?? []).map((s) => {
          const label = s.user_agent ? deviceLabel(s.user_agent) : t('Unknown device');
          const Icon = /Android|iPhone|iPad/.test(label) ? Smartphone : Laptop;
          return (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3">
              <Icon className="size-5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold">
                  {label} {s.is_current && <Badge variant="success">{t('This device')}</Badge>}
                </p>
                <p className="break-words text-[12px] text-muted-foreground">
                  {t('Last active {{d}}', { d: formatDateTime(s.last_active) })}
                  {s.ip ? ` · ${s.ip}` : ''}
                </p>
              </div>
              {!s.is_current && (
                <Button variant="ghost" size="sm" onClick={() => signOutOne(s.id)}>
                  {t('Sign out')}
                </Button>
              )}
            </div>
          );
        })}
        {sessions.data?.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">{t('No other devices.')}</p>
        )}
      </Card>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {t(
          'You can stay signed in on several phones at once. Signing out here takes effect within an hour on that device.',
        )}
      </p>

      <SectionTitle>{t('Security & privacy')}</SectionTitle>
      <Card className="divide-y">
        <Link to="/change-password" className="flex min-h-14 items-center gap-3 px-4 hover:bg-secondary/50">
          <KeyRound className="size-5 text-primary" />{' '}
          <span className="font-semibold">{t('Change PIN')}</span>
        </Link>
        <div className="flex gap-3 px-4 py-3 text-[12.5px] text-muted-foreground">
          <ShieldCheck className="size-5 shrink-0 text-primary" />
          <p>
            {t(
              'Privacy: when you acknowledge a notice we record the time, your IP address and device, and — only if you allow it at that moment — your location. Location is never tracked in the background and is deleted after the retention period set by the society.',
            )}
          </p>
        </div>
      </Card>
      <Button variant="outline" size="lg" className="mt-4 w-full" onClick={() => void signOut()}>
        <LogOut /> {t('Sign out of this device')}
      </Button>
    </div>
  );
}
