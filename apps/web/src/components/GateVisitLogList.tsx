import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PhoneCall, Search, UserRound } from 'lucide-react';
import { formatDateTime12 } from '@harmony/shared';
import { cn } from '@/lib/utils';
import { useGateVisitLog, useSocietyUnitOptions } from '@/lib/vehicleGate';
import { VehicleKindChip } from '@/components/VehicleKindChip';
import { ErrorState, ListSkeleton } from '@/components/States';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import type { GateVisitLogRow } from '@/types';

const PRESETS: { label: string; days: number | null }[] = [
  { label: '24 hours', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
  { label: '10 days', days: 10 },
  { label: '15 days', days: 15 },
  { label: 'All (30 days)', days: null },
];

function sinceFor(days: number | null): string | null {
  return days == null ? null : new Date(Date.now() - days * 86_400_000).toISOString();
}

function statusBadge(t: (k: string) => string, row: GateVisitLogRow) {
  switch (row.approval_status) {
    case 'pending':
      return <Badge variant="warning">{t('Waiting')}</Badge>;
    case 'approved':
      return <Badge variant="success">{t('Approved')}</Badge>;
    case 'denied':
      return <Badge variant="danger">{t('Denied')}</Badge>;
    default:
      return <Badge variant="muted">{t('No approval needed')}</Badge>;
  }
}

export function waitLabel(t: (k: string, o?: Record<string, number>) => string, seconds: number | null) {
  if (seconds == null) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 1) return t('under a minute');
  if (mins < 60) return t('{{n}} min', { n: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return t('{{h}}h {{m}}m', { h, m });
}

/**
 * Searchable gate-visit history, shared by the resident/admin "Vehicles → Log" tab and the guard's
 * own simple log on the gate screen. `compact` drops the flat filter and tightens the layout for the
 * gate screen; `showUnitFilter` is only offered to an admin/super-admin/guard (a resident only ever
 * sees their own flat, so there is nothing to filter).
 */
export function GateVisitLogList({
  societyId,
  showUnitFilter,
  compact = false,
}: {
  societyId: string;
  showUnitFilter: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [plate, setPlate] = useState('');
  const [days, setDays] = useState<number | null>(3);
  const [unitId, setUnitId] = useState('');
  const units = useSocietyUnitOptions(societyId, showUnitFilter);
  const log = useGateVisitLog(societyId, { plate, since: sinceFor(days), unitId: unitId || null, limit: 50 });

  const rows = log.data?.rows ?? [];

  return (
    <div className={cn(compact ? 'space-y-3' : 'space-y-4')}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={plate}
          onChange={(e) => setPlate(e.target.value.toUpperCase())}
          placeholder={t('Vehicle number')}
          className={cn('pl-10', compact && 'h-14 text-[18px] font-bold tracking-wide')}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setDays(p.days)}
            className={cn(
              'cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-bold transition-colors',
              days === p.days
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card hover:bg-secondary',
            )}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {showUnitFilter && (
        <NativeSelect value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t('All flats')}</option>
          {(units.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} · {u.name}
            </option>
          ))}
        </NativeSelect>
      )}

      {log.isLoading && !log.data ? (
        <ListSkeleton rows={3} />
      ) : log.error && !log.data ? (
        <ErrorState error={log.error} onRetry={() => log.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="p-4 text-center text-[14px] font-semibold text-muted-foreground">
          {t('No vehicle entries match this search.')}
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => {
            const wait = waitLabel(t, v.waited_seconds);
            return (
              <Card key={v.id} className={cn('p-3', compact && 'p-3.5')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <VehicleKindChip kind={v.kind} />
                    <span className={cn('tabular truncate font-extrabold tracking-wide', compact ? 'text-[19px]' : 'text-[16px]')}>
                      {v.plate_text}
                    </span>
                  </div>
                  {statusBadge(t, v)}
                </div>
                <p className="mt-1.5 break-words text-[13px] font-semibold text-muted-foreground">
                  {v.unit_name ?? t('Flat not known')}
                  {v.unit_code ? ` · ${v.unit_code}` : ''}
                </p>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {formatDateTime12(v.in_at)}
                  {v.out_at ? ` → ${formatDateTime12(v.out_at)}` : ` · ${t('Still at the gate')}`}
                </p>
                {v.approval_status !== 'auto' && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {v.approved_by_name ? (
                      <span className="inline-flex items-center gap-1 font-semibold">
                        {v.approved_via === 'guard_override' ? (
                          <PhoneCall className="size-3.5 text-amber-600" />
                        ) : (
                          <UserRound className="size-3.5 text-emerald-600" />
                        )}
                        {t('by {{name}}', { name: v.approved_by_name })}
                        {wait ? ` · ${t('waited {{time}}', { time: wait })}` : ''}
                      </span>
                    ) : wait ? (
                      <span className="font-semibold text-amber-700">{t('waiting {{time}}', { time: wait })}</span>
                    ) : null}
                  </p>
                )}
                {v.approval_note && (
                  <p className="mt-1 rounded-lg bg-muted/60 px-2 py-1 text-[12px] italic text-muted-foreground">
                    “{v.approval_note}”
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {log.data && log.data.total > rows.length && (
        <p className="text-center text-[12px] text-muted-foreground">
          {t('Showing the latest {{n}} of {{total}}. Narrow the search to see more.', {
            n: rows.length,
            total: log.data.total,
          })}
        </p>
      )}
    </div>
  );
}
