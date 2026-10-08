import { MyPending } from '@/components/MyPending';
import { CollectionsList } from '@/components/CollectionsList';
import { SeriesMonthCard } from '@/components/SeriesMonthCard';
import { SocietyPosition } from '@/components/SocietyPosition';
import { SurplusBoard } from '@/components/SurplusBoard';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarClock,
  ClipboardList,
  Download,
  FileText,
  MessageSquareWarning,
  Receipt,
  Sparkles,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { useDashboard, useNextMeeting, useSettings } from '@/lib/queries';
import { enablePush, pushSupported } from '@/lib/push';
import { useInstallPrompt } from '@/lib/install';
import { getLocal, setLocal } from '@/lib/storage';
import { isIOS, isStandalone } from '@/lib/utils';
import { Money } from '@/components/Money';
import { StatusChip } from '@/components/StatusChip';
import { CardSkeleton, ErrorState } from '@/components/States';
import { SectionTitle } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ReminderCards } from './reminders/ReminderCards';
import type { Dashboard } from '@/types';

export default function HomePage() {
  const { t } = useTranslation();
  const m = useMember();
  const settings = useSettings(m.societyId);
  const monthlyOn = settings.data?.monthly_dues_enabled !== false;
  const q = useDashboard(m.societyId);

  if (q.isLoading && !q.data)
    return (
      <div className="space-y-3">
        <CardSkeleton className="h-44" />
        <CardSkeleton className="h-28" />
        <CardSkeleton className="h-36" />
      </div>
    );
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const firstName = (m.fullName && m.fullName !== m.unit_name ? m.fullName.split(' ')[0] : m.unit_code) || m.fullName || '';

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <p className="text-sm text-muted-foreground">{t('Namaste')},</p>
        <h1 className="text-2xl font-extrabold tracking-tight">{firstName}</h1>
      </div>

      <BalanceHero d={d} />
      {d.mine && <MyFlatCard d={d} />}
      {d.mine && <MyPending unitId={d.mine.unit_id} />}
      {d.admin && <AdminAttention d={d} monthlyOn={monthlyOn} />}
      {monthlyOn ? <MonthProgress d={d} /> : <SeriesMonthCard />}
      <CollectionsList />
      <SocietyPosition />
      <SurplusBoard />
      <ReminderCards compact />
      <NextMeetingCard />
      <EnableExtras />

      {d.fixed_expenses.length > 0 && (
        <section>
          <SectionTitle action={<Link to="/events/recurring" className="text-[13px] font-semibold text-primary">{d.admin ? t('Manage') : t('History')}</Link>}>{t('Fixed monthly expenses')}</SectionTitle>
          <Card className="divide-y">
            {d.fixed_expenses.map((f) => (
              <div key={f.title} className="flex items-center gap-3 px-4 py-3">
                <CalendarClock className="size-5 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{t('Around day {{d}} of every month', { d: f.day_of_month })}</p>
                </div>
                <Money paise={f.amount_paise} className="font-bold" />
              </div>
            ))}
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>{t('Reports')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <QuickLink to={`/reports/month/${d.period}`} icon={<FileText />} label={t('This month')} />
          <QuickLink to="/reports/pending" icon={<AlertTriangle />} label={t('Pending list')} />
          <QuickLink to="/ledger" icon={<Receipt />} label={t('Full ledger')} />
          <QuickLink to="/reports" icon={<Sparkles />} label={t('Charts & more')} />
        </div>
      </section>
    </div>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="flex min-h-[64px] items-center gap-3 rounded-2xl border bg-card px-3.5 shadow-card transition-colors hover:bg-secondary/60">
      <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary [&_svg]:size-5">{icon}</span>
      <span className="text-[13.5px] font-semibold leading-tight">{label}</span>
    </Link>
  );
}

function BalanceHero({ d }: { d: Dashboard }) {
  const { t } = useTranslation();
  const general = d.funds.find((f) => f.kind === 'general');
  const others = d.funds.filter((f) => f.kind !== 'general');
  return (
    <div className="hero-gradient relative overflow-hidden rounded-3xl p-5 text-white shadow-lift">
      <div aria-hidden className="absolute -right-8 -top-8 size-40 rounded-full bg-lime-300/25 blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-white/85">
          <Wallet className="size-4" /> {t('Society balance')}
        </div>
        <p className="tabular mt-1 text-[38px] font-extrabold leading-none tracking-tight">{formatINR(d.balance_paise)}</p>
        <p className="mt-1.5 text-[12.5px] text-white/75">{t('Always calculated from the ledger: money in minus money out.')}</p>
        <div className="no-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1">
          {general && (
            <span className="glass shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold">
              {t('General')} · {formatINR(general.balance_paise)}
            </span>
          )}
          {others.map((f) => (
            <Link key={f.id} to={f.event_id ? `/events/${f.event_id}` : '/ledger'} className="glass shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold">
              {f.name} · {formatINR(f.balance_paise)}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function MyFlatCard({ d }: { d: Dashboard }) {
  const { t } = useTranslation();
  const mine = d.mine!;
  const pending = mine.pending_paise;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-muted-foreground">
            {t('My flat')} · <span className="tabular">{mine.unit_code}</span>
          </p>
          <p className="mt-0.5 text-[13px]">
            {periodLabel(d.period)}: <StatusChip status={mine.this_month.status} className="ml-1 align-middle" />
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-muted-foreground">{pending > 0 ? t('To pay') : mine.advance_paise > 0 ? t('Advance') : t('All clear')}</p>
          <p className={pending > 0 ? 'tabular text-2xl font-extrabold text-debit' : 'tabular text-2xl font-extrabold text-credit'}>
            {formatINR(pending > 0 ? pending : mine.advance_paise)}
          </p>
        </div>
      </div>
      {mine.pending_claims > 0 && (
        <p className="mx-4 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {t('{{count}} payment claim(s) waiting for admin verification', { count: mine.pending_claims })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 border-t bg-muted/30 p-3">
        <Button asChild variant={pending > 0 ? 'hero' : 'secondary'}>
          <Link to="/pay">
            <Wallet /> {pending > 0 ? t('Pay {{amount}}', { amount: formatINR(pending) }) : t('Pay')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dues">
            <ClipboardList /> {t('My dues')}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

function AdminAttention({ d, monthlyOn }: { d: Dashboard; monthlyOn: boolean }) {
  const { t } = useTranslation();
  const m = useMember();
  const a = d.admin!;
  const items = [
    monthlyOn && !a.dues_generated && m.can('generate_dues')
      ? { to: '/admin/dues', icon: <CalendarClock />, label: t('Generate dues for {{m}}', { m: periodLabel(d.period) }), n: 0, urgent: true }
      : null,
    a.pending_claims ? { to: '/admin/claims', icon: <BadgeCheck />, label: t('Payment claims to verify'), n: a.pending_claims } : null,
    a.pending_drafts ? { to: '/admin/expenses', icon: <Receipt />, label: t('Recurring expenses to confirm'), n: a.pending_drafts } : null,
    a.open_concerns ? { to: '/concerns', icon: <MessageSquareWarning />, label: t('Open concerns'), n: a.open_concerns } : null,
    a.pending_registrations ? { to: '/admin/members', icon: <UserPlus />, label: t('Registrations to approve'), n: a.pending_registrations } : null,
    a.open_alerts ? { to: '/admin/alerts', icon: <AlertTriangle />, label: t('Security alerts'), n: a.open_alerts } : null,
    a.suggested_contacts ? { to: '/contacts', icon: <UserPlus />, label: t('Contact suggestions'), n: a.suggested_contacts } : null,
  ].filter(Boolean) as { to: string; icon: React.ReactNode; label: string; n: number; urgent?: boolean }[];
  if (!items.length) return null;
  return (
    <section>
      <SectionTitle>{t('Needs your attention')}</SectionTitle>
      <Card className="divide-y">
        {items.map((i) => (
          <Link key={i.to + i.label} to={i.to} className="flex min-h-[56px] items-center gap-3 px-4 transition-colors hover:bg-secondary/50">
            <span className={i.urgent ? 'text-warning [&_svg]:size-5' : 'text-primary [&_svg]:size-5'}>{i.icon}</span>
            <span className="flex-1 text-sm font-semibold">{i.label}</span>
            {i.n > 0 && <span className="grid min-w-7 place-items-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">{i.n}</span>}
            <ArrowRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </section>
  );
}

function timeLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function NextMeetingCard() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useNextMeeting(m.societyId);
  if (!q.data) return null;
  const x = q.data;
  return (
    <Link to={`/meetings/${x.id}`} className="block">
      <Card className="p-4 transition-colors hover:bg-secondary/40">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <p className="text-[12.5px] font-semibold text-primary">{t('Next meeting')}</p>
        </div>
        <p className="mt-1 font-bold">{x.title}</p>
        <p className="text-[13px] text-muted-foreground">
          {formatDate(x.meeting_date)} · {timeLabel(x.start_time)} · {x.audience_label}
        </p>
        {x.agenda.length > 0 && (
          <p className="mt-2 truncate text-[12.5px] text-muted-foreground">
            {t('Agenda')}: {x.agenda.map((a) => a.text).join(' · ')}
          </p>
        )}
      </Card>
    </Link>
  );
}

function MonthProgress({ d }: { d: Dashboard }) {
  const { t } = useTranslation();
  const pct = d.month.expected_paise ? Math.min(100, Math.round((d.month.collected_paise / d.month.expected_paise) * 100)) : 0;
  const c = d.month.status_counts;
  const net = d.month.collected_paise - d.month.spent_paise;
  return (
    <Link to={`/reports/month/${d.period}`} className="block">
      <Card className="p-4 transition-colors hover:bg-secondary/40">
        <div className="flex items-center justify-between">
          <p className="font-bold">{t('{{m}} collection', { m: periodLabel(d.period) })}</p>
          <span className="text-[13px] font-semibold text-primary">{pct}%</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-500 to-lime-400 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="tabular mt-2 flex justify-between text-[13px]">
          <span>
            <strong>{formatINR(d.month.collected_paise)}</strong> <span className="text-muted-foreground">{t('collected')}</span>
          </span>
          <span className="text-muted-foreground">
            {t('of')} {formatINR(d.month.expected_paise)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {(
            [
              ['paid', t('Paid'), (c.paid ?? 0) + (c.advance ?? 0), 'text-credit'],
              ['partial', t('Partial'), c.partial ?? 0, 'text-warning'],
              ['pending', t('Pending'), c.pending ?? 0, 'text-debit'],
              ['waived', t('Waived'), c.waived ?? 0, 'text-muted-foreground'],
            ] as const
          ).map(([k, label, n, cls]) => (
            <div key={k} className="rounded-xl bg-muted/50 py-2">
              <p className={`tabular text-lg font-extrabold ${cls}`}>{n}</p>
              <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          {t('Spent this month')}: <strong className="text-foreground">{formatINR(d.month.spent_paise)}</strong>
          {' · '}
          {net >= 0 ? t('Surplus') : t('Shortfall')}: <Money paise={net} sign tone="auto" className="font-semibold" />
        </p>
      </Card>
    </Link>
  );
}

/** Push + install prompts, dismissible and remembered on this device */
function EnableExtras() {
  const { t } = useTranslation();
  const install = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => getLocal('hh-extras-dismissed') === '1');
  const [busy, setBusy] = useState(false);
  const status = useQuery({
    queryKey: ['pushPermission'],
    queryFn: () => (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'),
    staleTime: Infinity,
  });
  const showPush = pushSupported() && status.data === 'default';
  const showInstall = !isStandalone() && (install.available || isIOS());
  if (dismissed || (!showPush && !showInstall)) return null;
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-secondary to-card p-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <BellRing className="size-5" />
        </span>
        <div className="flex-1">
          <p className="font-bold">{t('Get notices and receipts instantly')}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {isIOS() && !isStandalone()
              ? t('On iPhone: tap Share, then "Add to Home Screen". Open Harmony from your home screen to turn on notifications.')
              : t('Install the app and allow notifications on this phone.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {showInstall && install.available && (
              <Button size="sm" onClick={() => void install.install()}>
                <Download /> {t('Install app')}
              </Button>
            )}
            {showPush && (
              <Button
                size="sm"
                variant={showInstall && install.available ? 'outline' : 'default'}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await enablePush().catch(() => 'denied' as const);
                  setBusy(false);
                  void status.refetch();
                  if (r === 'granted') toast.success(t('Notifications are on for this device'));
                  else toast.error(t('Notifications were blocked. You can allow them in your browser settings.'));
                }}
              >
                <BellRing /> {t('Allow notifications')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLocal('hh-extras-dismissed', '1');
                setDismissed(true);
              }}
            >
              {t('Not now')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

