import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CalendarClock, ShieldCheck, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatINR, periodLabel } from '@harmony/shared';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useFeeChangePrompt } from '@/lib/vehicleGate';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/**
 * Notice that the monthly security guard maintenance has gone up (new guard, higher salary).
 * - A flat member must tick the box and tap "I acknowledge". Nothing else can be done until they do, and the
 *   acknowledgement (flat, person, date and time) is recorded; admins and the super admin are notified.
 * - Admins and the super admin see the same notice with a progress line and can simply close it.
 * Shown before the vehicle popups.
 */
export function FeeChangeDialog() {
  const { t } = useTranslation();
  const m = useMember();
  const { ctx } = useAuth();
  const qc = useQueryClient();
  const q = useFeeChangePrompt(m.societyId, !!ctx?.profile?.welcomed_at);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  const { pathname } = useLocation();

  // Re-check on every screen change: an unacknowledged flat must see the notice again wherever it goes next,
  // even if an earlier check failed or was answered before the flat's data had loaded.
  useEffect(() => {
    if (!closed && ctx?.profile?.welcomed_at) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const p = q.data;
  if (closed || !p?.show || !p.change) return null;
  const c = p.change;
  const isAdminView = p.mode === 'admin';
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['feeChangePrompt'] });
    void qc.invalidateQueries({ queryKey: ['feeChangeOverview'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const acknowledge = async () => {
    setBusy(true);
    try {
      await rpc('acknowledge_fee_change', { p_fee_change_id: c.id });
      setClosed(true);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const closeAdmin = () => {
    setClosed(true);
    void rpc('mark_fee_change_seen_by_admin', { p_fee_change_id: c.id })
      .catch(() => undefined)
      .finally(refresh);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && isAdminView && closeAdmin()}>
      <DialogContent dismissible={isAdminView} hideClose className="flex flex-col p-0 sm:max-w-md">
        <div className="-mx-5 -mt-3 shrink-0 bg-gradient-to-br from-emerald-700 via-emerald-600 to-teal-600 px-5 pb-5 pt-6 text-center text-white">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-white/15 ring-4 ring-white/20">
            <ShieldCheck className="size-7" />
          </span>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">
            {isAdminView ? t('Notice shown to all members') : t('Important notice')}
          </p>
          <DialogTitle className="mt-1 text-[21px] font-extrabold leading-tight text-white">
            {t('Security guard maintenance revised')}
          </DialogTitle>
        </div>

        <div className="space-y-3.5 pb-2 pt-4">
          {isAdminView && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] leading-snug text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200">
              {t('Admin view: every member sees this notice and must acknowledge it. {{a}} of {{n}} flats have acknowledged so far.', {
                a: p.acknowledged ?? 0,
                n: p.total_flats ?? 0,
              })}
            </div>
          )}

          <DialogDescription className="text-[14.5px] leading-relaxed text-foreground">
            {t('Dear member, with the appointment of a new security guard and the revision of the guard\'s salary, the monthly security guard maintenance for every flat has been increased by {{inc}}.', {
              inc: formatINR(c.increase_paise),
            })}
          </DialogDescription>

          <div className="rounded-2xl border bg-secondary/40 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {t('Monthly maintenance per flat')}
            </p>
            <div className="mt-1.5 flex items-center justify-center gap-3">
              <span className="tabular text-[22px] font-bold text-muted-foreground line-through decoration-2">
                {formatINR(c.old_share_paise)}
              </span>
              <ArrowRight className="size-5 text-muted-foreground" />
              <span className="tabular text-[32px] font-extrabold leading-none text-primary">
                {formatINR(c.new_share_paise)}
              </span>
            </div>
            <p className="mx-auto mt-2 flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              <TrendingUp className="size-3.5" /> +{formatINR(c.increase_paise)} {t('per month')}
            </p>
          </div>

          <ul className="space-y-2 text-[13.5px] leading-snug">
            <li className="flex gap-2.5">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {t('Effective from {{d}}. The {{p}} collection, due {{due}}, and every month after it will be at the revised amount.', {
                  d: formatDate(c.effective_from),
                  p: periodLabel(c.effective_period),
                  due: formatDate(c.first_due_date ?? c.effective_from),
                })}
              </span>
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {t('Amounts already billed before this change stay at {{old}}; nothing you have paid is affected.', {
                  old: formatINR(c.old_share_paise),
                })}
              </span>
            </li>
          </ul>

          {!isAdminView && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3">
              <Checkbox checked={agree} onCheckedChange={(v) => setAgree(v === true)} className="mt-0.5" />
              <span className="text-[13.5px] leading-snug">
                {t('I have read this notice and understand that the monthly security guard maintenance for my flat is now {{new}}.', {
                  new: formatINR(c.new_share_paise),
                })}
              </span>
            </label>
          )}
        </div>

        <div className="sticky bottom-[-1.25rem] -mx-5 -mb-5 shrink-0 border-t bg-card px-5 pb-5 pt-3">
          {isAdminView ? (
            <Button className="w-full" size="lg" variant="outline" onClick={closeAdmin}>
              {t('Close')}
            </Button>
          ) : (
            <>
              <Button
                className="w-full"
                size="lg"
                variant="hero"
                disabled={!agree}
                loading={busy}
                onClick={() => void acknowledge()}
              >
                {t('I acknowledge')}
              </Button>
              <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                {t('Your acknowledgement is recorded for the society committee.')}
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
