import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage, rpc } from '@/lib/supabase';
import { useVehicleApprovals } from '@/lib/vehicleGate';
import { VehicleKindTile } from '@/components/VehicleKindChip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * A guest vehicle is waiting at the gate — approved or kept out right here.
 * Shown first on the Home page, and also on the Vehicles page (some notification-click paths
 * land there instead of the dedicated /vehicles/approve/:id card, so the action must be reachable
 * from both places).
 */
export function VehicleApprovalBanner({ societyId }: { societyId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useVehicleApprovals(societyId);
  const [busy, setBusy] = useState<string | null>(null);
  const list = q.data ?? [];
  if (list.length === 0) return null;

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setBusy(`${id}:${decision}`);
    try {
      await rpc('approve_gate_visit', { p_visit_id: id, p_decision: decision, p_via: 'resident' });
      toast.success(decision === 'approve' ? t('Vehicle let in') : t('Kept out'));
      void qc.invalidateQueries({ queryKey: ['vehicleApprovals'] });
      void qc.invalidateQueries({ queryKey: ['gateVisitLog'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-up space-y-2">
      {list.map((v) => (
        <Card
          key={v.id}
          className="border-2 border-amber-400/70 bg-amber-50 p-3.5 shadow-card dark:bg-amber-400/10"
        >
          <div className="flex items-center gap-3">
            <VehicleKindTile kind={v.kind} className="size-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="tabular break-words text-[18px] font-extrabold leading-tight tracking-wide text-amber-900 dark:text-amber-100">
                {v.plate_text}
              </p>
              <p className="truncate text-[12.5px] font-semibold text-amber-800/80 dark:text-amber-300/80">
                {t('Guard will not let the vehicle in without your approval')}
              </p>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-12 border-amber-700/30 text-[14.5px]"
              loading={busy === `${v.id}:deny`}
              disabled={!!busy}
              onClick={() => void decide(v.id, 'deny')}
            >
              {t('Keep out')}
            </Button>
            <Button
              className="h-12 bg-emerald-600 text-[14.5px] text-white hover:brightness-110"
              loading={busy === `${v.id}:approve`}
              disabled={!!busy}
              onClick={() => void decide(v.id, 'approve')}
            >
              {t('Let it in')}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
