import { MyPending } from '@/components/MyPending';
import { CollectionsList } from '@/components/CollectionsList';
import { SeriesMonthCard } from '@/components/SeriesMonthCard';
import { SocietyPositionCompact, usePosition } from '@/components/SocietyPosition';
import { SurplusBoard } from '@/components/SurplusBoard';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BellRing,
  CalendarClock,
  CalendarHeart,
  ChevronRight,
  ClipboardList,
  Download,
  FileDown,
  IndianRupee,
  MessageCircle,
  MessagesSquare,
  Share2,
  Phone,
  Search,
  Scale,
  FileText,
  MessageSquareWarning,
  Receipt,
  Sparkles,
  User,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { addDays, currentPeriod, istToday, formatDate, formatINR, periodLabel } from '@harmony/shared';
import { errorMessage, supabase } from '@/lib/supabase';
import { reportPdf } from '@/lib/pdf';
import { downloadBlob } from '@/lib/csv';
import { useAuth, useMember } from '@/lib/auth';
import { unwrap, useContactCategories, useDashboard, useNextMeeting, useSettings } from '@/lib/queries';
import { enablePush, pushSupported } from '@/lib/push';
import { useInstallPrompt } from '@/lib/install';
import { InstallHelp } from '@/components/InstallHelp';
import { getLocal, setLocal } from '@/lib/storage';
import { cn, isIOS, isIOSNonSafari, isStandalone, unitLabel } from '@/lib/utils';
import { Money } from '@/components/Money';
import { StatusChip } from '@/components/StatusChip';
import { CardSkeleton, ErrorState } from '@/components/States';
import { SectionTitle } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PendingPaymentDialog } from '@/components/PendingPaymentDialog';
import { FEEDBACK_SENT_KEY } from '@/lib/feedback';
import { useDirectory } from '@/pages/contacts/ContactsPage';
import { ReminderCards } from './reminders/ReminderCards';
import type { Dashboard } from '@/types';

function expenseState(f: Dashboard['fixed_expenses'][number]) {
  const todayDay = Number(istToday().slice(8, 10));
  const daysLeft = f.day_of_month - todayDay;
  const paid = f.draft_status === 'confirmed';
  const skipped = f.draft_status === 'skipped';
  const overdue = !paid && !skipped && f.draft_status === 'pending' && daysLeft < 0;
  const dueSoon = !paid && !skipped && !overdue && f.draft_status === 'pending' && daysLeft <= 2;
  return { paid, skipped, overdue, dueSoon, urgent: overdue || dueSoon };
}

export default function HomePage() {
  const { t } = useTranslation();
  const m = useMember();
  const { viewOnly } = useAuth();
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
  const firstName =
    (m.fullName && m.fullName !== m.unit_name ? m.fullName.split(' ')[0] : m.unit_code) || m.fullName || '';
  const urgentExpenses = d.fixed_expenses.filter((f) => expenseState(f).urgent);
  const otherExpenses = d.fixed_expenses.filter((f) => !expenseState(f).urgent);

  return (
    <div className="space-y-4 animate-fade-up">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('Namaste, {{n}} Ji', { n: firstName })}</h1>
      </div>

      {d.mine && !viewOnly && <PendingPaymentDialog dash={d} />}

      {urgentExpenses.length > 0 && (
        <div className="space-y-2.5">
          {urgentExpenses.map((f) => (
            <SocietyPaymentAlert key={f.title} f={f} isAdmin={!!d.admin} />
          ))}
        </div>
      )}

      {d.mine && <MyFlatCard d={d} monthlyOn={monthlyOn} />}
      {d.mine && <MyPending unitId={d.mine.unit_id} />}
      {d.admin && <AdminAttention d={d} monthlyOn={monthlyOn} />}

      <div className="grid grid-cols-2 gap-2.5">
        {d.mine && <QuickLink to="/pay" icon={<IndianRupee />} label={t('Pay / mark paid')} />}
        <QuickLink to="/dues" icon={<Wallet />} label={t('My dues')} />
        <QuickLink to="/ledger" icon={<Receipt />} label={t('Ledger')} />
        <QuickLink to="/reports/position" icon={<Scale />} label={t('Society position')} />
        <QuickLink to="/meetings" icon={<CalendarClock />} label={t('Meetings')} />
        <QuickLink to="/events" icon={<CalendarHeart />} label={t('Events')} />
        <QuickLink to="/profile" icon={<User />} label={t('Profile')} />
        <QuickLink to="/concerns/new" icon={<MessageSquareWarning />} label={t('Raise a concern')} />
      </div>

      <NextMeetingCard />

      <section>
        <SectionTitle>{t('Society overview')}</SectionTitle>
        <div className="space-y-4">
          {monthlyOn ? <MonthProgress d={d} /> : <SeriesMonthCard />}
          <BalanceHero />
          <CollectionsList />
          <SocietyPositionCompact />
          <SurplusBoard />
        </div>
      </section>

      <ReminderCards compact />
      <ImportantNumbersCard />
      {!viewOnly && <FeedbackNudge />}
      {!isStandalone() && (
        <Card className="border-primary/30 bg-gradient-to-br from-secondary to-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Download className="size-5" />
            </span>
            <div className="flex-1 space-y-2">
              <p className="font-bold">{t('Install the app')}</p>
              <InstallHelp />
            </div>
          </div>
        </Card>
      )}
      <EnableExtras />

      {otherExpenses.length > 0 && (
        <section>
          <SectionTitle
            action={
              <Link to="/events/recurring" className="text-[13px] font-semibold text-primary">
                {d.admin ? t('Manage') : t('History')}
              </Link>
            }
          >
            {t('Fixed monthly expenses')}
          </SectionTitle>
          <div className="space-y-2.5">
            {otherExpenses.map((f) => (
              <FixedExpenseRow key={f.title} f={f} isAdmin={!!d.admin} />
            ))}
          </div>
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

function FixedExpenseRow({ f, isAdmin }: { f: Dashboard['fixed_expenses'][number]; isAdmin: boolean }) {
  const { t } = useTranslation();
  const { paid, skipped, overdue, dueSoon } = expenseState(f);

  const card = paid
    ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-card'
    : overdue
      ? 'border-red-200 bg-gradient-to-br from-red-50 to-card'
      : dueSoon
        ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-card'
        : 'border-border bg-card';
  const iconTone = paid ? 'bg-emerald-600' : overdue ? 'bg-red-600' : dueSoon ? 'bg-amber-600' : 'bg-primary';
  const badge = paid ? (
    <Badge variant="success">{t('Paid')}</Badge>
  ) : skipped ? (
    <Badge variant="muted">{t('Skipped')}</Badge>
  ) : overdue ? (
    <Badge variant="danger">{t('Overdue')}</Badge>
  ) : dueSoon ? (
    <Badge variant="warning">{t('Due soon')}</Badge>
  ) : (
    <Badge variant="muted">{t('Pending')}</Badge>
  );

  const canConfirm = isAdmin && f.draft_id && !paid && !skipped;

  return (
    <Card className={cn('p-4', card)}>
      <div className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl text-white', iconTone)}>
          <CalendarClock className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words font-bold">{f.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {paid
              ? t('Paid {{a}}{{note}}', {
                  a: formatINR(f.confirmed_amount_paise ?? f.amount_paise),
                  note: f.confirmed_note ? ` · ${f.confirmed_note}` : '',
                })
              : t('Usually {{a}} · around day {{d}} of the month', {
                  a: formatINR(f.amount_paise),
                  d: f.day_of_month,
                })}
          </p>
          {paid && f.confirmed_by && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('Marked paid by {{n}}', { n: f.confirmed_by })}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {badge}
            {canConfirm && (
              <Button size="sm" variant="outline" asChild>
                <Link to={`/admin/expense?draft=${f.draft_id}`}>{t('Mark as paid')}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** A society-level bill (e.g. guard salary) that is due or overdue — clearly not the member's own dues. */
function SocietyPaymentAlert({ f, isAdmin }: { f: Dashboard['fixed_expenses'][number]; isAdmin: boolean }) {
  const { t } = useTranslation();
  const { overdue } = expenseState(f);
  return (
    <Card className="border-amber-200 bg-amber-50/80 p-4 dark:border-amber-500/25 dark:bg-amber-500/10">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
          <Wallet className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            {t('Society payment pending')}
          </p>
          <p className="truncate font-bold">{f.title}</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">
          {t('Unpaid')}
        </span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3 border-t border-amber-200/80 pt-3 dark:border-amber-500/20">
        <div>
          <p className="text-[11.5px] text-muted-foreground">{t('Amount to be paid')}</p>
          <p className="tabular text-xl font-extrabold">{formatINR(f.amount_paise)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11.5px] text-muted-foreground">{t('Payment status')}</p>
          <p className="text-[14px] font-bold text-amber-700 dark:text-amber-300">
            {overdue ? t('Overdue') : t('Due soon')}
          </p>
        </div>
      </div>
      <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900 dark:bg-white/5 dark:text-amber-200">
        {isAdmin
          ? t('Admin responsibility: pay this from the society fund and mark it as paid.')
          : t('The society admins are responsible for paying this. Nothing to pay from your side.')}
      </p>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {t("This is a society payment, separate from your flat's dues.")}
      </p>
      {isAdmin && f.draft_id && (
        <Button size="sm" variant="outline" asChild className="mt-3 w-full">
          <Link to={`/admin/expense?draft=${f.draft_id}`}>{t('Mark as paid')}</Link>
        </Button>
      )}
    </Card>
  );
}

function QuickLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[64px] items-center gap-3 rounded-2xl border bg-card px-3.5 shadow-card transition-colors hover:bg-secondary/60"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-[13.5px] font-semibold leading-tight">{label}</span>
    </Link>
  );
}

function BalanceHero() {
  const { t } = useTranslation();
  const m = useMember();
  const cur = currentPeriod();
  const pos = usePosition();
  const monthStart = `${cur}-01`;
  const recv = useQuery({
    queryKey: ['monthReceived', m.societyId, cur],
    queryFn: async () =>
      unwrap<{ fund_id: string; fund_name: string; signed_paise: number }[]>(
        await supabase
          .from('v_ledger')
          .select('fund_id, fund_name, signed_paise')
          .eq('society_id', m.societyId)
          .in('category', ['maintenance', 'event_contribution'])
          .gte('entry_date', monthStart),
      ),
  });
  // Group by fund, taking the real fund/event name straight from the ledger row — never a generic
  // fallback — so a payment is always labelled with what it was actually for, even for a fund that
  // has since been fully settled and dropped from the live funds list below.
  const byFund = new Map<string, { name: string; v: number }>();
  for (const r of recv.data ?? []) {
    const row = byFund.get(r.fund_id) ?? { name: r.fund_name, v: 0 };
    row.v += r.signed_paise;
    byFund.set(r.fund_id, row);
  }
  const fundById = new Map((pos.data?.funds ?? []).map((f) => [f.id, f]));
  // "Earlier months" = money received this month for a period before the society's balance-start
  // month, so it is correctly left out of the current-balance figure above.
  const currentRows = [...byFund]
    .filter(([id, r]) => r.v !== 0 && fundById.get(id)?.counted !== false)
    .map(([id, r]) => ({ ...r, scope: fundById.get(id)?.scope_label ?? null }));
  const earlier = [...byFund]
    .filter(([id]) => fundById.get(id)?.counted === false)
    .reduce((s, [, r]) => s + r.v, 0);
  const received = currentRows.reduce((s, r) => s + r.v, 0) + earlier;
  const p = pos.data;
  // Overall = funds shared by every flat. Flat-type-only events (e.g. 3BHK) are always kept separate.
  const overallFunds = (p?.funds ?? []).filter((f) => !f.scope_label && f.balance_paise !== 0);
  const scopedFunds = (p?.scoped ?? []).filter((g) => g.balance_paise !== 0);
  // Late money for months before the balance-start month: real cash, shown so no rupee is hidden,
  // but kept out of the balance above (those months' expenses were never recorded here).
  const earlierFunds = (p?.funds ?? []).filter((f) => !f.scope_label && (f.earlier_balance_paise ?? 0) !== 0);
  return (
    <Card className="overflow-hidden p-0 shadow-lift">
      <div className="hero-gradient relative overflow-hidden px-4 pb-4 pt-3.5 text-white">
        <div
          aria-hidden
          className="absolute -right-10 -top-12 size-44 rounded-full bg-lime-300/35 blur-2xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-12 -left-10 size-40 rounded-full bg-teal-300/25 blur-2xl"
        />
        <div className="relative">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-white/90">
              <span className="grid size-7 place-items-center rounded-full bg-white/15">
                <Wallet className="size-[15px]" />
              </span>
              {t('Society balance')}
            </span>
            <span className="rounded-full bg-lime-300 px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-wide text-emerald-900">
              {t('All flats')}
            </span>
          </div>
          <p className="tabular mt-2 text-[38px] font-extrabold leading-none tracking-tight">
            {p ? formatINR(p.totals.balance_paise) : '—'}
          </p>
          <p className="mt-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-lime-200">
            {t('After expenses · counted from Sep 2026')}
          </p>
          {received > 0 && (
            <Link
              to={`/reports/month/${cur}`}
              className="glass mt-3 flex items-center justify-between gap-3 rounded-2xl px-3 py-2"
            >
              <span className="text-[12.5px] font-semibold text-white/90">
                {t('Received in {{m}}', { m: periodLabel(cur) })}
              </span>
              <span className="tabular flex items-center gap-1 text-[15px] font-extrabold">
                {formatINR(received)}
                <ChevronRight className="size-4 text-white/70" />
              </span>
            </Link>
          )}
        </div>
      </div>

      {(received > 0 || overallFunds.length > 0 || scopedFunds.length > 0 || earlierFunds.length > 0) && (
        <div className="divide-y px-4 py-1">
          {received > 0 && (
            <div className="py-1.5">
              <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('This month came in for')}
              </p>
              {currentRows.map((r) => (
                <BalanceRow
                  key={r.name}
                  label={r.name}
                  value={r.v}
                  tag={r.scope ? t('{{t}} only', { t: r.scope }) : undefined}
                />
              ))}
              {earlier > 0 && <BalanceRow label={t('Earlier months (late payments)')} value={earlier} />}
            </div>
          )}
          {(overallFunds.length > 0 || scopedFunds.length > 0 || earlierFunds.length > 0) && (
            <div className="py-1.5">
              <p className="pt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('Money held in each fund')}
              </p>
              {overallFunds.map((f) => (
                <BalanceRow
                  key={f.id}
                  label={f.kind === 'general' ? t('General') : f.name}
                  value={f.balance_paise}
                  to={f.event_id ? `/events/${f.event_id}` : '/ledger'}
                />
              ))}
              {earlierFunds.map((f) => (
                <BalanceRow
                  key={f.id}
                  label={f.name}
                  value={f.earlier_balance_paise ?? 0}
                  tag={t('Not in balance')}
                  to={f.event_id ? `/events/${f.event_id}` : '/ledger'}
                />
              ))}
              {scopedFunds.map((g) => (
                <BalanceRow
                  key={g.label}
                  label={t('Only for {{t}} events', { t: g.label })}
                  value={g.balance_paise}
                  tag={t('Separate')}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function BalanceRow({ label, value, tag, to }: { label: string; value: number; tag?: string; to?: string }) {
  const body = (
    <>
      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {tag && (
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          {tag}
        </span>
      )}
      <span className="tabular shrink-0 text-[13px] font-bold">{formatINR(value)}</span>
    </>
  );
  return to ? (
    <Link to={to} className="flex items-center gap-2 py-2 transition-colors hover:text-primary">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-2 py-2">{body}</div>
  );
}

function MyFlatCard({ d, monthlyOn }: { d: Dashboard; monthlyOn: boolean }) {
  const { t } = useTranslation();
  const mine = d.mine!;
  const pending = mine.pending_paise;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-muted-foreground">
            {t('My flat')} · <span className="tabular">{unitLabel(mine.unit_code)}</span>
          </p>
          {monthlyOn ? (
            <p className="mt-0.5 text-[13px]">
              {periodLabel(d.period)}:{' '}
              <StatusChip status={mine.this_month.status} className="ml-1 align-middle" />
            </p>
          ) : (
            <p className="mt-0.5 text-[13px]">{pending > 0 ? t('Pending dues') : t('No pending dues')}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[12px] text-muted-foreground">
            {pending > 0 ? t('To pay') : mine.advance_paise > 0 ? t('Advance') : t('All clear')}
          </p>
          <p
            className={
              pending > 0
                ? 'tabular text-2xl font-extrabold text-debit'
                : 'tabular text-2xl font-extrabold text-credit'
            }
          >
            {formatINR(pending > 0 ? pending : mine.advance_paise)}
          </p>
        </div>
      </div>
      {mine.pending_claims > 0 && (
        <p className="mx-4 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {t('{{count}} payment claim(s) waiting for admin verification', { count: mine.pending_claims })}
        </p>
      )}
      <div
        className={`grid gap-2 border-t bg-muted/30 p-3 ${monthlyOn || pending > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}
      >
        {(monthlyOn || pending > 0) && (
          <Button asChild variant={pending > 0 ? 'hero' : 'secondary'}>
            <Link to="/pay">
              <Wallet /> {pending > 0 ? t('Pay {{amount}}', { amount: formatINR(pending) }) : t('Pay')}
            </Link>
          </Button>
        )}
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
      ? {
          to: '/admin/dues',
          icon: <CalendarClock />,
          label: t('Generate dues for {{m}}', { m: periodLabel(d.period) }),
          n: 0,
          urgent: true,
        }
      : null,
    a.pending_claims
      ? {
          to: '/admin/claims',
          icon: <BadgeCheck />,
          label: t('Payment claims to verify'),
          n: a.pending_claims,
        }
      : null,
    a.pending_drafts
      ? {
          to: '/admin/expenses',
          icon: <Receipt />,
          label: t('Recurring expenses to confirm'),
          n: a.pending_drafts,
        }
      : null,
    a.open_concerns
      ? { to: '/concerns', icon: <MessageSquareWarning />, label: t('Open concerns'), n: a.open_concerns }
      : null,
    a.pending_registrations
      ? {
          to: '/admin/members',
          icon: <UserPlus />,
          label: t('Registrations to approve'),
          n: a.pending_registrations,
        }
      : null,
    a.open_alerts
      ? { to: '/admin/alerts', icon: <AlertTriangle />, label: t('Security alerts'), n: a.open_alerts }
      : null,
    a.suggested_contacts
      ? { to: '/contacts', icon: <UserPlus />, label: t('Contact suggestions'), n: a.suggested_contacts }
      : null,
  ].filter(Boolean) as { to: string; icon: React.ReactNode; label: string; n: number; urgent?: boolean }[];
  if (!items.length) return null;
  return (
    <section>
      <SectionTitle>{t('Needs your attention')}</SectionTitle>
      <Card className="divide-y">
        {items.map((i) => (
          <Link
            key={i.to + i.label}
            to={i.to}
            className="flex min-h-[56px] items-center gap-3 px-4 transition-colors hover:bg-secondary/50"
          >
            <span className={i.urgent ? 'text-warning [&_svg]:size-5' : 'text-primary [&_svg]:size-5'}>
              {i.icon}
            </span>
            <span className="flex-1 text-sm font-semibold">{i.label}</span>
            {i.n > 0 && (
              <span className="grid min-w-7 place-items-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                {i.n}
              </span>
            )}
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
  if (!q.data || q.data.meeting_date < istToday()) return null;
  const x = q.data;
  const today = istToday();
  const when =
    x.meeting_date === today
      ? t('Today')
      : x.meeting_date === addDays(today, 1)
        ? t('Tomorrow')
        : formatDate(x.meeting_date);
  return (
    <Link
      to={`/meetings/${x.id}`}
      className="flex items-center gap-3 overflow-hidden rounded-2xl border border-violet-300/60 bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-3.5 text-white shadow-lift transition-opacity hover:opacity-95"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/20">
        <CalendarClock className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/80">{t('Meeting called')}</p>
        <p className="truncate text-[14.5px] font-extrabold leading-snug">{x.title}</p>
        <p className="truncate text-[12.5px] font-semibold text-white/90">
          {when} · {timeLabel(x.start_time)}
          {x.location ? ` · ${x.location}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-[12px] font-bold text-white/90">{t('View agenda')} →</span>
    </Link>
  );
}

function ImportantNumbersCard() {
  const { t } = useTranslation();
  const m = useMember();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dir = useDirectory(m.societyId);
  const cats = useContactCategories(m.societyId);
  const counts = new Map<string, number>();
  for (const c of dir.data ?? [])
    if (c.status === 'active') counts.set(c.category_id, (counts.get(c.category_id) ?? 0) + 1);
  const tags = (cats.data ?? []).filter((c) => counts.has(c.id)).slice(0, 6);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const active = (dir.data ?? []).filter((c) => c.status === 'active');
  const preview = active.slice(0, 3);
  const [pdfBusy, setPdfBusy] = useState(false);
  const sharePdf = async () => {
    setPdfBusy(true);
    try {
      const blob = await reportPdf('Important numbers', m.society_name, [
        {
          title: 'Trusted contacts',
          table: {
            head: ['Name', 'Service', 'Phone', 'Timings'],
            body: active.map((c) => [c.name, c.category, c.phones.join(', '), c.timings ?? '']),
          },
        },
      ]);
      downloadBlob('important-numbers.pdf', blob);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPdfBusy(false);
    }
  };
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    nav(q.trim() ? `/contacts?q=${encodeURIComponent(q.trim())}` : '/contacts');
  };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-xl bg-secondary text-primary">
            <Phone className="size-[18px]" />
          </span>
          <div>
            <p className="font-bold leading-tight">{t('Important numbers')}</p>
            <p className="text-[12px] text-muted-foreground">
              {total ? t('{{n}} trusted contacts', { n: total }) : t('Plumber, electrician, tank cleaner…')}
            </p>
          </div>
        </div>
        <Link to="/contacts" className="text-[13px] font-bold text-primary">
          {t('View all')}
        </Link>
      </div>
      <form onSubmit={go} className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('Search plumber, electrician, name…')}
          className="pl-10"
          aria-label={t('Search')}
        />
      </form>
      {preview.length > 0 && (
        <div className="mt-3 space-y-2">
          {preview.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                <Phone className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[13.5px] font-semibold">{c.name}</p>
                <p className="text-[12px] text-muted-foreground">
                  {t(c.category)}
                  {c.phones[0] ? ` · ${c.phones[0]}` : ''}
                </p>
              </div>
              {c.phones[0] && (
                <button
                  type="button"
                  onClick={() => openWhatsAppText(contactLine(c))}
                  className="grid size-9 shrink-0 place-items-center rounded-full border text-primary"
                  aria-label={t('Share {{n}} on WhatsApp', { n: c.name })}
                >
                  <Share2 className="size-4" />
                </button>
              )}
              {c.phones[0] && (
                <a
                  href={`tel:${c.phones[0]}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                  aria-label={t('Call {{n}}', { n: c.name })}
                >
                  <Phone className="size-4" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {active.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" loading={pdfBusy} onClick={() => void sharePdf()}>
            {!pdfBusy && <FileDown />} {t('PDF')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openWhatsAppText(
                [`*${m.society_name} — Important numbers*`, '', ...active.map(contactLine)].join('\n'),
              )
            }
          >
            <MessageCircle /> {t('WhatsApp')}
          </Button>
        </div>
      )}
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.map((c) => (
            <Link
              key={c.id}
              to={`/contacts?category=${c.id}`}
              className="rounded-full border bg-card px-3 py-1.5 text-[12.5px] font-semibold hover:bg-secondary"
            >
              {t(c.name)} · {counts.get(c.id)}
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function contactLine(c: { name: string; category: string; phones: string[] }) {
  return `• ${c.name} (${c.category}): ${c.phones.join(', ')}`;
}

function openWhatsAppText(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function MonthProgress({ d }: { d: Dashboard }) {
  const { t } = useTranslation();
  const pct = d.month.expected_paise
    ? Math.min(100, Math.round((d.month.collected_paise / d.month.expected_paise) * 100))
    : 0;
  const c = d.month.status_counts;
  const net = d.month.collected_paise - d.month.spent_paise;
  return (
    <Link to={`/reports/month/${d.period}`} className="block">
      <Card className="p-4 transition-colors hover:bg-secondary/40">
        <div className="flex items-center justify-between">
          <p className="font-bold">{t('{{m}} collection', { m: periodLabel(d.period) })}</p>
          <span className="text-[13px] font-semibold text-primary">{pct}%</span>
        </div>
        <div
          className="mt-3 h-3 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-emerald-500 to-lime-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="tabular mt-2 flex justify-between text-[13px]">
          <span>
            <strong>{formatINR(d.month.collected_paise)}</strong>{' '}
            <span className="text-muted-foreground">{t('collected')}</span>
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
          {t('Spent this month')}:{' '}
          <strong className="text-foreground">{formatINR(d.month.spent_paise)}</strong>
          {' · '}
          {net >= 0 ? t('Surplus') : t('Shortfall')}:{' '}
          <Money paise={net} sign tone="auto" className="font-semibold" />
        </p>
      </Card>
    </Link>
  );
}

/** Every now and then, ask members for app feedback. Remembered on this device only. */
function FeedbackNudge() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => {
    const now = Date.now();
    const day = 86_400_000;
    let first = getLocal('hh-first-seen');
    if (!first) {
      first = new Date().toISOString();
      setLocal('hh-first-seen', first);
    }
    const ago = (k: string) => {
      const v = getLocal(k);
      return v ? (now - new Date(v).getTime()) / day : Infinity;
    };
    // first ask after 2 days of use; then not within 14 days of "Not now" or 30 days of sending
    return (
      now - new Date(first).getTime() < 2 * day ||
      ago('hh-feedback-dismissed-at') < 14 ||
      ago(FEEDBACK_SENT_KEY) < 30
    );
  });
  if (hidden) return null;
  return (
    <Card className="border-violet-200 bg-gradient-to-br from-violet-50 to-card p-4 dark:border-violet-500/20 dark:from-violet-500/10">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
          <MessagesSquare className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{t('Any feedback or suggestion for the app?')}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t('Tell us what new feature you would like. It goes straight to the super admin.')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" asChild>
              <Link to="/feedback">{t('Suggest here')}</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLocal('hh-feedback-dismissed-at', new Date().toISOString());
                setHidden(true);
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
            {isIOSNonSafari() && !isStandalone()
              ? t(
                  'On iPhone, please install from Safari: tap ⋯ or the address bar, choose "Open in Safari", then tap Share → "Add to Home Screen". Chrome on iPhone cannot install apps — this is an Apple restriction.',
                )
              : isIOS() && !isStandalone()
                ? t(
                    'On iPhone: tap Share, then "Add to Home Screen". Open Harmony from your home screen to turn on notifications.',
                  )
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
                  else
                    toast.error(
                      t('Notifications were blocked. You can allow them in your browser settings.'),
                    );
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
