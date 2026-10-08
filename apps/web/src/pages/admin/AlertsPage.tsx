import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { AlertRow } from '@/types';

const KIND: Record<string, [string, 'danger' | 'warning' | 'info']> = {
  duplicate_registration: ['Duplicate registration', 'warning'],
  registration_pending: ['Registration', 'info'],
  failed_logins: ['Failed sign-ins', 'danger'],
  payment_details_changed: ['Payment details changed', 'danger'],
};

const DETAIL_LABELS: Record<string, string> = {
  unit_code: 'Flat',
  name: 'Name',
  phone: 'Mobile',
  username: 'Account',
  ip: 'IP',
  old_upi: 'Old UPI ID',
  new_upi: 'New UPI ID',
  old_payee: 'Old payee',
  new_payee: 'New payee',
  qr_changed: 'QR changed',
};

export default function AlertsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const q = useQuery({
    queryKey: ['alerts', m.societyId, showResolved],
    queryFn: async () => {
      let qb = supabase.from('alerts').select('*').eq('society_id', m.societyId).order('created_at', { ascending: false }).limit(100);
      if (!showResolved) qb = qb.is('resolved_at', null);
      return unwrap<AlertRow[]>(await qb);
    },
  });

  const resolve = async (id: string) => {
    try {
      await rpc('resolve_alert', { p_alert_id: id });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Security alerts')} back="/more" />
      <label className="mb-3 flex cursor-pointer items-center gap-2 px-1 text-sm font-semibold">
        <Switch checked={showResolved} onCheckedChange={setShowResolved} /> {t('Show resolved')}
      </label>
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<ShieldAlert className="size-7" />} title={t('No open alerts')} />)}>
        {(list) => (
          <div className="space-y-2.5">
            {list.map((a) => {
              const [label, variant] = KIND[a.kind] ?? [a.kind, 'info'];
              return (
                <Card key={a.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={variant}>{t(label)}</Badge>
                    <span className="text-[12px] text-muted-foreground">{formatDateTime(a.created_at)}</span>
                  </div>
                  <p className="mt-2 font-semibold">{a.title}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                    {Object.entries(a.details ?? {})
                      .filter(([k]) => DETAIL_LABELS[k])
                      .map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="text-muted-foreground">{t(DETAIL_LABELS[k]!)}</dt>
                          <dd className="break-all font-medium">{String(v ?? '—')}</dd>
                        </div>
                      ))}
                  </dl>
                  {a.resolved_at ? (
                    <p className="mt-2 text-[12px] text-muted-foreground">{t('Resolved {{d}}', { d: formatDateTime(a.resolved_at) })}</p>
                  ) : (
                    <Button size="sm" variant="outline" className="mt-3" onClick={() => resolve(a.id)}>
                      <CheckCircle2 /> {t('Mark resolved')}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </QueryState>
    </div>
  );
}
