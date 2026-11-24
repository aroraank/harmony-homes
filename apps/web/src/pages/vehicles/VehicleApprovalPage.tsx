import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime12 } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { VehicleKindTile } from '@/components/VehicleKindChip';
import type { VehicleApprovalDetail } from '@/types';

/**
 * Where the "guest vehicle at your gate" notification and the home-page banner both lead.
 * A guest vehicle for this flat waits here — nothing lets it in until someone taps Approve.
 */
export default function VehicleApprovalPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const m = useMember();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  const q = useQuery({
    queryKey: ['vehicleApprovalDetail', id],
    enabled: !!id,
    refetchInterval: 15_000,
    queryFn: () => rpc<VehicleApprovalDetail>('vehicle_approval_detail', { p_visit_id: id }),
  });

  const decide = async (decision: 'approve' | 'deny') => {
    if (!id) return;
    setBusy(decision);
    try {
      await rpc('approve_gate_visit', { p_visit_id: id, p_decision: decision, p_via: 'resident' });
      toast.success(decision === 'approve' ? t('Vehicle let in') : t('Kept out'));
      void qc.invalidateQueries({ queryKey: ['vehicleApprovalDetail', id] });
      void qc.invalidateQueries({ queryKey: ['vehicleApprovals'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <CardSkeleton className="h-64" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;
  const decided = v.approval_status !== 'pending';

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Guest vehicle')} back="/" />
      <Card className="p-5 text-center">
        <VehicleKindTile kind={v.kind} className="mx-auto size-20" />
        <p className="tabular mt-3 text-[28px] font-extrabold tracking-wide">{v.plate_text}</p>
        <p className="mt-1 text-[14px] font-semibold text-muted-foreground">
          {v.unit_name ?? v.unit_code} · {formatDateTime12(v.in_at)}
        </p>

        {!decided && (
          <>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[13.5px] font-semibold text-amber-700 dark:text-amber-400">
              <ShieldAlert className="size-4" />
              {t('This vehicle is waiting at the gate. It will not be let in until you decide.')}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Button
                size="xl"
                variant="outline"
                className="h-16 text-[16px]"
                loading={busy === 'deny'}
                disabled={!!busy}
                onClick={() => void decide('deny')}
              >
                <XCircle /> {t('Keep out')}
              </Button>
              <Button
                size="xl"
                className="h-16 bg-emerald-600 text-[16px] text-white hover:brightness-110"
                loading={busy === 'approve'}
                disabled={!!busy}
                onClick={() => void decide('approve')}
              >
                <CheckCircle2 /> {t('Let it in')}
              </Button>
            </div>
          </>
        )}

        {decided && (
          <p
            className={
              v.approval_status === 'approved'
                ? 'mt-4 flex items-center justify-center gap-1.5 text-[14px] font-bold text-emerald-700 dark:text-emerald-400'
                : 'mt-4 flex items-center justify-center gap-1.5 text-[14px] font-bold text-muted-foreground'
            }
          >
            {v.approval_status === 'approved' ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
            {v.approval_status === 'approved' ? t('Already let in') : t('Already kept out')}
          </p>
        )}
      </Card>
      {m.isAdmin && (
        <Button variant="ghost" className="mt-3 w-full" onClick={() => nav('/vehicles')}>
          {t('Society vehicles')}
        </Button>
      )}
    </div>
  );
}
