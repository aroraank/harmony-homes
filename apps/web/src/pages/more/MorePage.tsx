import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  Building2,
  CalendarClock,
  Download,
  FileClock,
  IndianRupee,
  LogOut,
  MessageSquareWarning,
  Phone,
  Receipt,
  Repeat,
  Settings,
  ShieldAlert,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth, useMember } from '@/lib/auth';
import { useInstallPrompt } from '@/lib/install';
import { initials, isStandalone } from '@/lib/utils';
import { brand } from '@/brand';
import { SectionTitle } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import type { Permission } from '@/types';

type Item = { to: string; label: string; Icon: typeof Users; perm?: Permission; superOnly?: boolean; adminOnly?: boolean };

export default function MorePage() {
  const { t } = useTranslation();
  const m = useMember();
  const { memberships, setActiveSociety, signOut } = useAuth();
  const install = useInstallPrompt();

  const society: Item[] = [
    { to: '/concerns', label: m.isAdmin ? t('Concerns inbox') : t('My concerns'), Icon: MessageSquareWarning },
    { to: '/contacts', label: t('Contacts'), Icon: Phone },
    { to: '/reminders', label: t('Reminders'), Icon: BellRing },
    { to: '/reports', label: t('Reports & charts'), Icon: BarChart3 },
  ];
  const admin: Item[] = [
    { to: '/admin/payment', label: t('Record payment'), Icon: IndianRupee, perm: 'record_payment' },
    { to: '/admin/expense', label: t('Record expense'), Icon: Receipt, perm: 'record_expense' },
    { to: '/admin/claims', label: t('Payment claims'), Icon: BadgeCheck, perm: 'approve_claims' },
    { to: '/admin/dues', label: t('Dues & months'), Icon: CalendarClock, perm: 'generate_dues' },
    { to: '/admin/expenses', label: t('Recurring expenses'), Icon: Repeat, perm: 'record_expense' },
    { to: '/admin/transfer', label: t('Move money between funds'), Icon: ArrowLeftRight, perm: 'manage_events' },
    { to: '/admin/members', label: t('Members & logins'), Icon: Users, perm: 'manage_users' },
    { to: '/admin/units', label: t('Flats & blocks'), Icon: Building2, perm: 'manage_units' },
    { to: '/admin/settings', label: t('Society settings'), Icon: Settings, perm: 'manage_settings' },
    { to: '/admin/audit', label: t('Audit log'), Icon: FileClock, adminOnly: true },
    { to: '/admin/alerts', label: t('Security alerts'), Icon: ShieldAlert, adminOnly: true },
  ];
  const visibleAdmin = admin.filter((i) => (i.perm ? m.can(i.perm) : i.adminOnly ? m.isAdmin : true));

  return (
    <div className="animate-fade-up">
      <Link to="/profile" className="flex items-center gap-3 rounded-3xl border bg-card p-4 shadow-card hover:bg-secondary/50">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-lg font-extrabold text-white">{initials(m.fullName)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold">{m.fullName}</p>
          <p className="truncate text-[13px] text-muted-foreground">
            {m.unit_code ? `${m.unit_code} · ` : ''}
            {m.role === 'super_admin' ? t('Super admin') : m.role === 'admin' ? t('Admin') : t('Resident')}
          </p>
        </div>
        <UserCog className="size-5 text-muted-foreground" />
      </Link>

      {memberships.length > 1 && (
        <div className="mt-3">
          <NativeSelect value={m.societyId} onChange={(e) => setActiveSociety(e.target.value)} aria-label={t('Society')}>
            {memberships.map((x) => (
              <option key={x.society_id} value={x.society_id}>
                {x.society_name}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <SectionTitle>{t('Society')}</SectionTitle>
      <Grid items={society} />

      {visibleAdmin.length > 0 && (
        <>
          <SectionTitle>{t('Admin')}</SectionTitle>
          <Grid items={visibleAdmin} />
        </>
      )}

      <SectionTitle>{t('App')}</SectionTitle>
      <Card className="divide-y">
        {!isStandalone() && install.available && (
          <button type="button" onClick={() => void install.install()} className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-left hover:bg-secondary/50">
            <Download className="size-5 text-primary" /> <span className="font-semibold">{t('Install Harmony Homes')}</span>
          </button>
        )}
        <Link to="/profile" className="flex min-h-14 items-center gap-3 px-4 hover:bg-secondary/50">
          <Settings className="size-5 text-primary" /> <span className="font-semibold">{t('Profile, language & devices')}</span>
        </Link>
      </Card>
      <Button variant="outline" className="mt-4 w-full" size="lg" onClick={() => void signOut()}>
        <LogOut /> {t('Sign out of this device')}
      </Button>
      <p className="mt-6 text-center text-[12px] text-muted-foreground">
        {brand.name} · {m.society_name}
      </p>
    </div>
  );
}

function Grid({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {items.map(({ to, label, Icon }) => (
        <Link key={to} to={to} className="flex min-h-[92px] flex-col justify-between rounded-2xl border bg-card p-3.5 shadow-card transition-colors hover:bg-secondary/60">
          <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
            <Icon className="size-5" />
          </span>
          <span className="text-[13.5px] font-semibold leading-tight">{label}</span>
        </Link>
      ))}
    </div>
  );
}
