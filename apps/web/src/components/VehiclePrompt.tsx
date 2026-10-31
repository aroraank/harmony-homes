import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bike, Car, Sparkles, Truck, X } from 'lucide-react';
import { useAuth, useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import type { VehiclePromptInfo } from '@/types';

/**
 * One-time announcement introducing the vehicle directory, shown after the welcome popup to a
 * member whose flat has no vehicle on record yet. The CTA takes them straight to the Vehicles
 * page to add one; "Maybe later" dismisses it for good via dismiss_vehicle_prompt.
 */
export function VehiclePrompt() {
  const { t } = useTranslation();
  const m = useMember();
  const { ctx } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [closed, setClosed] = useState(false);

  const ask = useQuery({
    queryKey: ['vehiclePrompt', m.societyId],
    enabled: !!ctx?.profile?.welcomed_at && !!m.unit_id,
    staleTime: 0, // always re-check on open/focus, so it reaches an already-logged-in member promptly
    queryFn: () => rpc<VehiclePromptInfo>('my_vehicle_prompt', { p_society: m.societyId }),
  });

  // Close immediately on click — don't wait on the dismiss RPC / cache refetch round trip,
  // which could otherwise leave the dialog visibly stuck open until a second click.
  const dismiss = (goToVehicles: boolean) => {
    setClosed(true);
    void rpc('dismiss_vehicle_prompt').catch(() => {});
    void qc.invalidateQueries({ queryKey: ['vehiclePrompt'] });
    if (goToVehicles) nav('/vehicles', { state: { autoOpenAdd: true } });
  };

  if (closed || !ask.data?.show) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && dismiss(false)}>
      <DialogContent hideClose className="overflow-hidden sm:max-w-sm">
        <div className="hero-gradient relative -mx-5 -mt-3 overflow-hidden px-5 pb-8 pt-9 text-center text-white">
          <Bike className="absolute -left-2 top-5 size-9 -rotate-12 text-white/20" aria-hidden />
          <Truck className="absolute -right-3 bottom-3 size-10 rotate-6 text-white/15" aria-hidden />
          <Sparkles className="absolute right-8 top-6 size-4 animate-pulse text-lime" aria-hidden />

          <button
            type="button"
            onClick={() => dismiss(false)}
            aria-label={t('Close')}
            className="absolute right-3 top-3 grid size-9 cursor-pointer place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="size-4.5" />
          </button>

          <div className="relative mx-auto grid size-20 animate-pop-in place-items-center rounded-full bg-white/15 ring-4 ring-white/25">
            <Car className="size-10" />
          </div>
        </div>

        <div className="pt-5 text-center">
          <DialogTitle className="text-[21px] font-extrabold leading-tight">
            {t('Add your vehicles')}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-1.5 max-w-[30ch] text-[14.5px]">
            {t('So neighbours can reach you and the guard knows it belongs here — takes 20 seconds.')}
          </DialogDescription>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            variant="hero"
            size="xl"
            className="h-14 text-[16px]"
            onClick={() => dismiss(true)}
          >
            <Car className="!size-5" /> {t('Add my vehicle')}
          </Button>
          <Button variant="ghost" onClick={() => dismiss(false)}>
            {t('Maybe later')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
