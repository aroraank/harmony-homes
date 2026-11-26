import { useTranslation } from 'react-i18next';
import { BellOff, BellRing, Minus } from 'lucide-react';
import { useNotificationOptInReport } from '@/lib/queries';
import { QueryState } from '@/components/States';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/** Admin-only: who has push notifications on, off, or never decided — so this can be chased up by flat. */
export function NotificationOptInPanel({ societyId }: { societyId: string }) {
  const { t } = useTranslation();
  const q = useNotificationOptInReport(societyId);
  const rows = q.data ?? [];
  const on = rows.filter((r) => r.push_opt_in === true).length;
  const off = rows.filter((r) => r.push_opt_in === false).length;
  const undecided = rows.length - on - off;

  return (
    <QueryState query={q}>
      {() => (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-[13px]">
            <Badge variant="success">{t('{{n}} on', { n: on })}</Badge>
            <Badge variant="danger">{t('{{n}} off', { n: off })}</Badge>
            <Badge variant="muted">{t('{{n}} never decided', { n: undecided })}</Badge>
          </div>
          <Card className="divide-y">
            {rows.map((r) => (
              <div key={r.user_id} className="flex items-center gap-3 px-4 py-3">
                <span className="tabular w-16 shrink-0 font-bold">{r.unit_code ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {r.device_count > 0
                      ? t('{{n}} device(s) with notifications', { n: r.device_count })
                      : t('No device registered')}
                  </p>
                </div>
                {r.push_opt_in === true ? (
                  <Badge variant="success">
                    <BellRing className="size-3.5" /> {t('On')}
                  </Badge>
                ) : r.push_opt_in === false ? (
                  <Badge variant="danger">
                    <BellOff className="size-3.5" /> {t('Off')}
                  </Badge>
                ) : (
                  <Badge variant="muted">
                    <Minus className="size-3.5" /> {t('Not decided')}
                  </Badge>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}
    </QueryState>
  );
}
