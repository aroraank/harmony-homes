import { useTranslation } from 'react-i18next';
import { Sparkles, Timer, Trophy } from 'lucide-react';
import { waitLabel } from '@/components/GateVisitLogList';
import { ErrorState, ListSkeleton } from '@/components/States';
import { useMyApprovalSpeed, useVehicleApprovalStats } from '@/lib/vehicleGate';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Admin/super-admin report: every flat's average time to approve or deny a guest vehicle at its own
 * gate, slowest first — who to nudge, and who's always quick about it. Only counts a flat's own
 * decisions (not a guard's phone-override), and only flats with at least 2 decisions on record.
 */
export function ApprovalSpeedReport({ societyId }: { societyId: string }) {
  const { t } = useTranslation();
  const stats = useVehicleApprovalStats(societyId);
  const rows = stats.data ?? [];
  const fastestSeconds = rows.length ? Math.min(...rows.map((r) => r.avg_wait_seconds)) : null;

  if (stats.isLoading && !stats.data) return <ListSkeleton rows={4} />;
  if (stats.error && !stats.data) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;
  if (rows.length === 0) {
    return (
      <Card className="p-4 text-center text-[14px] font-semibold text-muted-foreground">
        {t('Not enough approvals yet — this fills in once a few flats have approved a guest vehicle.')}
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted-foreground">
        {t('How long each flat takes to approve or deny a guest vehicle, on their own — not counting times the guard let someone in by phone. Slowest first.')}
      </p>
      {rows.map((r) => {
        const isFastest = r.avg_wait_seconds === fastestSeconds;
        return (
          <Card key={r.unit_id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="break-words text-[15px] font-extrabold">{r.unit_name}</span>
                <span className="text-[12px] font-semibold text-muted-foreground">{r.unit_code}</span>
                {isFastest && (
                  <Badge variant="success">
                    <Trophy className="size-3.5" /> {t('Quickest')}
                  </Badge>
                )}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {t('{{n}} decisions · fastest {{f}} · slowest {{s}}', {
                  n: r.decisions,
                  f: waitLabel(t, r.fastest_seconds),
                  s: waitLabel(t, r.slowest_seconds),
                })}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn('text-[18px] font-extrabold tabular', isFastest && 'text-emerald-600')}>
                {waitLabel(t, r.avg_wait_seconds)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t('on average')}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * The resident's own "fun fact": shown only once they have at least 2 decisions on record, and only
 * ever naming the flats that are QUICKER than them — never the slower ones, so nobody's name ends up
 * on a public "slow" list.
 */
export function ApprovalSpeedFunFact({ societyId }: { societyId: string }) {
  const { t } = useTranslation();
  const speed = useMyApprovalSpeed(societyId);
  const d = speed.data;
  if (!d?.eligible || !d.faster_flats) return null;

  return (
    <Card className="border-2 border-violet-400/50 bg-violet-50 p-4 dark:bg-violet-500/10">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white">
          <Sparkles className="size-6" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t('Fun fact')}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold leading-snug">
            <Timer className="size-4 shrink-0" />
            {t('You usually approve a guest vehicle in {{time}}', { time: waitLabel(t, d.my_avg_seconds ?? 0) })}
          </p>
          {d.faster_count === 0 ? (
            <p className="mt-1.5 text-[13.5px] font-semibold text-emerald-700 dark:text-emerald-400">
              {t("No one in the society is quicker than you right now!")}
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[13.5px]">
                {t('{{n}} flat(s) are a little quicker than you:', { n: d.faster_count })}
              </p>
              <ul className="mt-1 space-y-0.5">
                {d.faster_flats.map((f) => (
                  <li key={f.unit_code} className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold">
                      {f.unit_name} <span className="text-muted-foreground">({f.unit_code})</span>
                    </span>
                    <span className="tabular text-muted-foreground">{waitLabel(t, f.avg_seconds)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
