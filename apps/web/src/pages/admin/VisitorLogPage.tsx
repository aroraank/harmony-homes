import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarRange, Clock, Download, LogIn, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { addDays, formatDateTime, formatDateTime12, istToday, splitMinutes } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { useSettings, useUnits } from '@/lib/queries';
import { downloadCsv } from '@/lib/csv';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Field } from '@/components/Field';
import { UnitSelect } from '@/components/UnitSelect';
import { VehicleKindChip } from '@/components/VehicleKindChip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import type { VisitorLogRow } from '@/types';

type Status = 'all' | 'inside' | 'left';

/** Guest vehicle log with filters. Entries are deleted automatically after the retention period. */
export default function VisitorLogPage() {
  const { t } = useTranslation();
  const m = useMember();
  const units = useUnits(m.societyId);
  const settings = useSettings(m.societyId);
  const today = istToday();
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [plate, setPlate] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [savingDays, setSavingDays] = useState(false);

  const q = useQuery({
    queryKey: ['visitorLog', m.societyId, from, to, plate, unitId, status, timeFrom, timeTo],
    queryFn: () =>
      rpc<VisitorLogRow[]>('visitor_log', {
        p_society: m.societyId,
        p_from: from || null,
        p_to: to || null,
        p_plate: plate || null,
        p_unit_id: unitId || null,
        p_status: status,
        p_time_from: timeFrom || null,
        p_time_to: timeTo || null,
      }),
  });

  if (!m.isAdmin) return <EmptyState title={t('You do not have permission to do this.')} />;

  const rows = q.data ?? [];
  const retention = settings.data?.visitor_log_retention_days ?? 15;

  const reset = () => {
    setFrom(addDays(today, -7));
    setTo(today);
    setPlate('');
    setUnitId('');
    setStatus('all');
    setTimeFrom('');
    setTimeTo('');
  };

  const exportCsv = () =>
    downloadCsv(
      `visitor-log-${from}-to-${to}.csv`,
      [t('Vehicle'), t('Flat'), t('In'), t('Out'), t('Minutes'), t('Marked in by'), t('Marked out by')],
      rows.map((r) => [
        r.plate_text,
        r.unit_name ?? '',
        formatDateTime(r.in_at),
        r.out_at ? formatDateTime(r.out_at) : '',
        r.minutes ?? '',
        r.in_by ?? '',
        r.out_by ?? '',
      ]),
    );

  const setRetention = async (days: number) => {
    setSavingDays(true);
    try {
      await rpc('set_visitor_log_retention', { p_society: m.societyId, p_days: days });
      await settings.refetch();
      toast.success(t('Saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingDays(false);
    }
  };

  /** How long a vehicle stayed, shown in full (minutes, or hours/days) instead of being hidden past 10 hours. */
  const formatStay = (minutes: number) => {
    const { days, hours, minutes: mins } = splitMinutes(minutes);
    if (days > 0) return hours > 0 ? t('{{d}}d {{h}}h', { d: days, h: hours }) : t('{{d}}d', { d: days });
    if (hours > 0) return mins > 0 ? t('{{h}}h {{m}}m', { h: hours, m: mins }) : t('{{h}}h', { h: hours });
    return t('{{n}} min', { n: mins });
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Visitor vehicles')}
        subtitle={t('Guest vehicles marked in and out at the gate.')}
        back
        actions={
          rows.length > 0 ? (
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download /> {t('CSV')}
            </Button>
          ) : undefined
        }
      />

      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t('From')}>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('To')}>
            <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Vehicle number')} optional>
          <Input
            value={plate}
            placeholder={t('Any part of the number')}
            autoCapitalize="characters"
            onChange={(e) => setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, ''))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t('Flat')} optional>
            <UnitSelect
              units={units.data ?? []}
              value={unitId}
              placeholder={t('All flats')}
              onChange={(e) => setUnitId(e.target.value)}
            />
          </Field>
          <Field label={t('Status')}>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="all">{t('All')}</option>
              <option value="inside">{t('Still inside')}</option>
              <option value="left">{t('Gone out')}</option>
            </NativeSelect>
          </Field>
        </div>
        <Field
          label={t('Time of day (optional)')}
          hint={t('Only show vehicles that were inside between these clock times on the selected dates.')}
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Input
              type="time"
              value={timeFrom}
              aria-label={t('From time')}
              onChange={(e) => setTimeFrom(e.target.value)}
            />
            <Input
              type="time"
              value={timeTo}
              aria-label={t('To time')}
              onChange={(e) => setTimeTo(e.target.value)}
            />
          </div>
        </Field>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw /> {t('Reset filters')}
        </Button>
      </Card>

      <p className="mt-3 px-1 text-[12.5px] text-muted-foreground">
        <CalendarRange className="mr-1 inline size-3.5 align-[-2px]" />
        {t('{{count}} entries', { count: rows.length })}
        {(timeFrom || timeTo) && (
          <>
            {' · '}
            <Clock className="mr-1 inline size-3.5 align-[-2px]" />
            {timeFrom || '00:00'}–{timeTo || '23:59'}
          </>
        )}
      </p>

      <div className="mt-2">
        <QueryState
          query={q}
          empty={(d) =>
            d.length === 0 ? (
              <EmptyState
                icon={<LogIn className="size-7" />}
                title={t('No guest vehicles for these filters')}
                hint={t('Older entries are deleted automatically.')}
              />
            ) : null
          }
        >
          {(list) => (
            <div className="space-y-2">
              {list.map((r) => (
                <Card key={r.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <VehicleKindChip kind={r.kind} />
                    {r.out_at ? (
                      <Badge variant="muted">{r.minutes !== null ? formatStay(r.minutes) : t('Gone out')}</Badge>
                    ) : (
                      <Badge variant="warning">{t('Inside')}</Badge>
                    )}
                  </div>
                  <p className="tabular mt-2 break-words text-[17px] font-extrabold leading-tight tracking-wide">
                    {r.plate_text}
                  </p>
                  <p className="break-words text-[13px] font-semibold text-muted-foreground">
                    {r.unit_name ?? t('Flat not known')}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
                    <div>
                      <dt className="text-muted-foreground">{t('In')}</dt>
                      <dd className="font-semibold">{formatDateTime12(r.in_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('Out')}</dt>
                      <dd className="font-semibold">{r.out_at ? formatDateTime12(r.out_at) : '—'}</dd>
                    </div>
                  </dl>
                  {(r.in_by || r.out_by) && (
                    <p className="mt-1.5 break-words text-[12px] text-muted-foreground">
                      {r.in_by ? `${t('In by')} ${r.in_by}` : ''}
                      {r.out_by ? ` · ${t('Out by')} ${r.out_by}` : ''}
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </QueryState>
      </div>

      {m.can('manage_settings') && (
        <Card className="mt-5 p-4">
          <Field
            label={t('Keep guest entries for')}
            hint={t('Older entries are deleted automatically every night to save space.')}
          >
            <NativeSelect
              value={String(retention)}
              disabled={savingDays}
              onChange={(e) => void setRetention(Number(e.target.value))}
            >
              <option value="7">{t('7 days')}</option>
              <option value="15">{t('15 days')}</option>
              <option value="30">{t('30 days')}</option>
            </NativeSelect>
          </Field>
        </Card>
      )}
    </div>
  );
}
