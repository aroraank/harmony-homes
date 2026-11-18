import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bike, Car, CheckCircle2, ShieldCheck, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@harmony/shared';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useFeeChangePrompt, useVehicleGate, useVehicles } from '@/lib/vehicleGate';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

/** "n of 3 skips left" as three dots, so the member can see at a glance how many chances remain. */
function SkipDots({ left, max }: { left: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`size-2 rounded-full ${i < left ? 'bg-primary' : 'bg-muted-foreground/25'}`} />
      ))}
    </span>
  );
}

/**
 * Vehicle registration, one popup at a time and only after the maintenance-change notice has been dealt with:
 *  - ask   : "add your vehicles" with an "I do not have a vehicle" answer and up to 3 skips (counted per flat);
 *  - force : after the 3rd skip, on the Home screen only, add a vehicle or say there is none — no skipping;
 *  - review: every 3 months, confirm the flat's vehicles are still right (tenants change).
 * Admins, super admins and view-as sessions never see these.
 */
export function VehiclePrompt() {
  const { t } = useTranslation();
  const m = useMember();
  const { ctx } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [closed, setClosed] = useState(false);
  const [confirmNone, setConfirmNone] = useState(false);
  const [busy, setBusy] = useState(false);

  // The fee notice comes first; if that query fails we do not block the vehicle prompt on it.
  const fee = useFeeChangePrompt(m.societyId, !!ctx?.profile?.welcomed_at && !!m.unit_id);
  const feeClear = fee.isSuccess ? !fee.data.show : fee.isError;
  const gateQ = useVehicleGate(m.societyId, !!ctx?.profile?.welcomed_at && !!m.unit_id && feeClear);
  const vehicles = useVehicles(m.societyId);
  const g = gateQ.data;

  const refreshGate = () => {
    void qc.invalidateQueries({ queryKey: ['vehicleGate'] });
    void qc.invalidateQueries({ queryKey: ['vehicles'] });
  };

  const addVehicle = () => {
    setClosed(true);
    nav('/vehicles', { state: { autoOpenAdd: true } });
  };

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
      refreshGate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    setClosed(true); // close immediately; the count is saved in the background
    void rpc('skip_vehicle_prompt', { p_society: m.societyId })
      .catch(() => undefined)
      .finally(refreshGate);
  };
  const declareNone = () =>
    void run(() => rpc('declare_no_vehicle', { p_society: m.societyId }), () => {
      setClosed(true);
      toast.success(t('Noted — your flat is marked as having no vehicle.'));
    });

  if (!g?.applies) return null;
  const onVehiclesPage = loc.pathname.startsWith('/vehicles');

  // ---- 3-monthly review ---------------------------------------------------------------------
  if (g.state === 'done' && g.review_due) {
    if (closed || onVehiclesPage) return null;
    const mine = (vehicles.data ?? []).filter((v) => v.unit_id === g.unit_id);
    const needsTag = g.untagged_count > 0;
    const confirm = () =>
      void run(() => rpc('confirm_vehicles', { p_society: m.societyId }), () => {
        setClosed(true);
        toast.success(t('Thank you — vehicles confirmed.'));
      });
    const later = () => {
      setClosed(true);
      void rpc('snooze_vehicle_review', { p_society: m.societyId })
        .catch(() => undefined)
        .finally(refreshGate);
    };
    const manage = () => {
      setClosed(true);
      nav('/vehicles');
    };
    return (
      <Dialog open onOpenChange={(o) => !o && later()}>
        <DialogContent hideClose className="sm:max-w-sm">
          <div className="pt-2 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <CheckCircle2 className="size-7" />
            </span>
            <DialogTitle className="mt-3 text-[20px] font-extrabold leading-tight">
              {t('Please confirm your flat\'s vehicles')}
            </DialogTitle>
            <DialogDescription className="mx-auto mt-1.5 max-w-[34ch] text-[14px]">
              {g.no_vehicle
                ? t('You told us your flat has no vehicle. Is that still correct?')
                : t('Check that these vehicles are still correct. If your tenants have changed, remove the old tenant vehicles and add the new ones.')}
            </DialogDescription>
          </div>

          {!g.no_vehicle && (
            <ul className="mt-4 space-y-1.5">
              {mine.map((v) => (
                <li key={v.id} className="flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2">
                  {v.kind === 'car' || v.kind === 'other' ? <Car className="size-4" /> : <Bike className="size-4" />}
                  <span className="tabular flex-1 text-[15px] font-bold tracking-wide">{v.plate_text}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
                      v.holder === 'tenant'
                        ? 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300'
                        : v.holder === 'owner'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
                    }`}
                  >
                    {v.holder === 'tenant' ? t('Tenant') : v.holder === 'owner' ? t('Owner') : t('Not tagged')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {needsTag && (
            <p className="mt-2 text-[12.5px] font-semibold text-amber-700 dark:text-amber-300">
              {t('Mark each vehicle as Owner or Tenant before confirming.')}
            </p>
          )}
          {g.last_confirmed_at && (
            <p className="mt-2 text-center text-[12px] text-muted-foreground">
              {t('Last confirmed on {{d}}', { d: formatDate(g.last_confirmed_at) })}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-2">
            {g.no_vehicle ? (
              <>
                <Button variant="hero" size="lg" loading={busy} onClick={confirm}>
                  {t('Yes, still no vehicle')}
                </Button>
                <Button variant="outline" onClick={addVehicle}>
                  {t('I have a vehicle now')}
                </Button>
              </>
            ) : needsTag ? (
              <Button variant="hero" size="lg" onClick={manage}>
                {t('Update my vehicles')}
              </Button>
            ) : (
              <>
                <Button variant="hero" size="lg" loading={busy} onClick={confirm}>
                  {t('All correct — confirm')}
                </Button>
                <Button variant="outline" onClick={manage}>
                  {t('Update my vehicles')}
                </Button>
              </>
            )}
            <Button variant="ghost" onClick={later}>
              {t('Remind me later')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (g.state === 'done') return null;

  // ---- forced: after 3 skips, on the Home screen only ------------------------------------------
  const forced = g.state === 'force';
  if (forced && loc.pathname !== '/') return null;
  if (!forced && (closed || onVehiclesPage)) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && !forced && skip()}>
      <DialogContent hideClose dismissible={!forced} className="overflow-hidden sm:max-w-sm">
        <div className="hero-gradient relative -mx-5 -mt-3 overflow-hidden px-5 pb-8 pt-9 text-center text-white">
          <Bike className="absolute -left-2 top-5 size-9 -rotate-12 text-white/20" aria-hidden />
          <Truck className="absolute -right-3 bottom-3 size-10 rotate-6 text-white/15" aria-hidden />
          <div className="relative mx-auto grid size-20 animate-pop-in place-items-center rounded-full bg-white/15 ring-4 ring-white/25">
            <Car className="size-10" />
          </div>
        </div>

        <div className="pt-5 text-center">
          <DialogTitle className="text-[21px] font-extrabold leading-tight">
            {forced ? t('Vehicle details are required') : t('Add your vehicles')}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1.5 max-w-[32ch] text-[14.5px]">
            {forced
              ? t('You have used all 3 skips. Please add your vehicles, or tell us if your flat has none.')
              : t('So neighbours can reach you and the guard knows it belongs here — takes 20 seconds.')}
          </DialogDescription>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-[13px] leading-snug text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <span>{t('The security guard will allow only the vehicles registered here, other than guest vehicles.')}</span>
        </div>

        {confirmNone ? (
          <div className="mt-5 space-y-2">
            <p className="text-center text-[14px] font-semibold">
              {t('Confirm that your flat has no vehicle?')}
            </p>
            <Button variant="hero" size="lg" className="w-full" loading={busy} onClick={declareNone}>
              {t('Yes, I do not have any vehicle')}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setConfirmNone(false)}>
              {t('Go back')}
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            <Button variant="hero" size="xl" className="h-14 text-[16px]" onClick={addVehicle}>
              <Car className="!size-5" /> {t('Add my vehicle')}
            </Button>
            <Button variant="outline" size="lg" onClick={() => setConfirmNone(true)}>
              {t('I do not have a vehicle')}
            </Button>
            {!forced && (
              <>
                <Button variant="ghost" onClick={skip}>
                  {t('Skip for now')}
                </Button>
                <p className="flex items-center justify-center gap-2 text-center text-[12.5px] text-muted-foreground">
                  <SkipDots left={g.skips_left} max={g.max_skips} />
                  {g.skips_left > 1
                    ? t('You have {{n}} skips left', { n: g.skips_left })
                    : t('This is your last skip')}
                </p>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
