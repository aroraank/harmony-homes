import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Siren, Wallet } from 'lucide-react';
import { currentPeriod, formatINR } from '@harmony/shared';
import { useAuth, useMember } from '@/lib/auth';
import { useFeeChangePrompt } from '@/lib/vehicleGate';
import { usePendingFixed, type PendingFixed } from '@/lib/fixedExpenses';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { SalaryPeriodNote } from './SalaryPeriodNote';
import { PaymentBlockedDialog } from './PaymentBlockedDialog';

/** Unpaid recurring payments (every month, oldest first) for an admin who can record expenses. */
export function usePendingFixedExpenses() {
  const m = useMember();
  const q = usePendingFixed(m.societyId, m.can('record_expense'));
  return { list: q.data ?? [], isLoading: q.isLoading };
}

const headline = (f: PendingFixed, t: (k: string, o?: Record<string, unknown>) => string) =>
  f.period < currentPeriod()
    ? t('Mark {{title}} as paid for {{month}}', { title: f.title, month: f.period_label })
    : t('Mark {{title}} as paid for this month — {{month}}', { title: f.title, month: f.period_label });

const OverdueChip = () => {
  const { t } = useTranslation();
  return (
    <span data-testid="overdue-chip" className="ml-2 inline-block rounded-full bg-rose-600 px-2.5 py-0.5 align-middle text-[11px] font-bold uppercase tracking-wide text-white">
      {t('Overdue')}
    </span>
  );
};

/** Bold card at the very top of Home for admins until every unpaid month is marked as paid. */
export function ExpenseDueBanner() {
  const { t } = useTranslation();
  const { list } = usePendingFixedExpenses();
  const [blocked, setBlocked] = useState<PendingFixed | null>(null);
  if (!list.length) return null;
  return (
    <div className="space-y-2.5" data-testid="expense-due-banner">
      {list.map((f) => (
        <Card
          key={f.draft_id}
          className={
            f.overdue
              ? 'border-2 border-rose-400 bg-gradient-to-br from-rose-50 to-card p-4 shadow-sm dark:border-rose-500/50 dark:from-rose-500/10'
              : 'border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-card p-4 shadow-sm dark:border-amber-500/50 dark:from-amber-500/10'
          }
        >
          <div className="flex items-start gap-3">
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl text-white ${f.overdue ? 'bg-rose-600' : 'bg-amber-500'}`}>
              <Wallet className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-[16px] font-extrabold leading-snug">{headline(f, t)}{f.period < currentPeriod() && <OverdueChip />}</p>
              <SalaryPeriodNote period={f.period} className="mt-1.5" />
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('Amount {{a}}. It will be deducted from the society balance and every member will see it.', {
                  a: formatINR(f.amount_paise),
                })}
              </p>
              {f.shortfall_paise > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-rose-700 dark:text-rose-300">
                  <Siren className="size-4" />
                  {t('Society balance {{b}} is {{s}} short.', { b: formatINR(f.balance_paise), s: formatINR(f.shortfall_paise) })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link to={`/admin/expense?draft=${f.draft_id}`}>{t('Mark as paid')}</Link>
                </Button>
                {(f.shortfall_paise > 0 || f.can_report_blocked) && (
                  <Button size="sm" variant="outline" onClick={() => setBlocked(f)}>
                    {t('Cannot pay yet?')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
      {blocked && <PaymentBlockedDialog item={blocked} open onOpenChange={(o) => !o && setBlocked(null)} />}
    </div>
  );
}

/** Popup shown to admins once per login session as soon as the app opens, if a payment is still unpaid. */
export function ExpenseDueDialog() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { ctx } = useAuth();
  const m = useMember();
  const fee = useFeeChangePrompt(m.societyId, !!ctx?.profile?.welcomed_at);
  const { list } = usePendingFixedExpenses();
  const f = list[0];
  const key = f ? `hh-expense-due-${f.draft_id}` : '';
  const [open, setOpen] = useState(false);

  // wait until the welcome and fee notices are out of the way
  // (not while the admin is already on the expense screens, marking it as paid)
  const ready = !!ctx?.profile?.welcomed_at && fee.isSuccess && !fee.data.show && !pathname.startsWith('/admin/expense');
  useEffect(() => {
    if (!f || !ready) return;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage blocked: show once per mount */
    }
    setOpen(true);
  }, [f, ready, key]);

  if (!f) return null;
  return (
    <Dialog open={open && !pathname.startsWith('/admin/expense')} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <div className="mx-auto mb-1 grid size-14 place-items-center rounded-full bg-amber-100 text-amber-700 ring-4 ring-amber-50">
          <CalendarClock className="size-7" />
        </div>
        <DialogTitle className="text-center text-[19px] font-extrabold leading-snug">{headline(f, t)}{f.period < currentPeriod() && <OverdueChip />}</DialogTitle>
        <SalaryPeriodNote period={f.period} className="text-center" />
        <DialogDescription className="text-center text-[14px] leading-relaxed text-foreground">
          {t('{{title}} of {{a}} is waiting for you. Tap "Mark as paid" to record it; it is deducted from the society balance and all members are told.', {
            title: f.title,
            a: formatINR(f.amount_paise),
          })}
          {list.length > 1 && ' ' + t('{{n}} months are unpaid in total.', { n: list.length })}
        </DialogDescription>
        <DialogFooter className="mt-2 flex-col gap-2 sm:flex-col">
          <Button size="lg" variant="hero" className="w-full" onClick={() => nav(`/admin/expense?draft=${f.draft_id}`)}>
            {t('Mark as paid')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
            {t('Remind me later')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
