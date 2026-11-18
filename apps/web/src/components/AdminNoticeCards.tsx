import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, Car, ChevronDown, Clock, ShieldCheck } from 'lucide-react';
import { formatDateTime, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { SectionTitle } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import type { FeeChangeOverview, VehicleCompliance } from '@/types';

/**
 * Admin / super admin Home cards:
 *  1. who has acknowledged the maintenance-increase notice (and who has not yet),
 *  2. vehicle registration across all flats (vehicles added, "no vehicle" answers, flats yet to answer).
 */
export function AdminNoticeCards() {
  const m = useMember();
  const fee = useQuery({
    queryKey: ['feeChangeOverview', m.societyId],
    queryFn: () => rpc<FeeChangeOverview[]>('fee_change_overview', { p_society: m.societyId }),
    refetchInterval: 120_000,
  });
  const veh = useQuery({
    queryKey: ['vehicleCompliance', m.societyId],
    queryFn: () => rpc<VehicleCompliance>('vehicle_compliance', { p_society: m.societyId }),
    refetchInterval: 120_000,
  });
  const latest = fee.data?.[0];
  if (!latest && !veh.data) return null;
  return (
    <div className="space-y-3">
      {latest && <FeeAckCard c={latest} />}
      {veh.data && <VehicleComplianceCard c={veh.data} />}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'ok' | 'wait' | 'info' | 'warn'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    wait: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    info: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
    warn: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
  }[tone];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}

function FeeAckCard({ c }: { c: FeeChangeOverview }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const done = c.flats.filter((f) => f.status !== 'pending');
  const pending = c.flats.filter((f) => f.status === 'pending');
  const pct = c.flats.length ? Math.round((done.length / c.flats.length) * 100) : 0;
  return (
    <section>
      <SectionTitle>{t('Maintenance increase')}</SectionTitle>
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
          aria-expanded={open}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-tight">
              {t('{{a}} of {{n}} flats have acknowledged', { a: done.length, n: c.flats.length })}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t('Guard maintenance {{o}} → {{n}} a month', {
                o: formatINR(c.old_share_paise),
                n: formatINR(c.new_share_paise),
              })}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <ul className="divide-y border-t">
            {[...pending, ...done].map((f) => (
              <li key={f.unit_id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 shrink-0 text-[13.5px] font-bold">{f.code}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                  {f.status === 'acknowledged' && f.at
                    ? `${f.who ? `${f.who} · ` : ''}${formatDateTime(f.at)}`
                    : f.status === 'seen_by_admin'
                      ? t('Admin has seen the notice')
                      : t('Not yet acknowledged')}
                </span>
                {f.status === 'acknowledged' ? (
                  <Chip tone="ok">
                    <BadgeCheck className="mr-0.5 inline size-3" />
                    {t('Acknowledged')}
                  </Chip>
                ) : f.status === 'seen_by_admin' ? (
                  <Chip tone="info">{t('Seen')}</Chip>
                ) : (
                  <Chip tone="wait">
                    <Clock className="mr-0.5 inline size-3" />
                    {t('Pending')}
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function VehicleComplianceCard({ c }: { c: VehicleCompliance }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const has = c.flats.filter((f) => f.status === 'has_vehicles');
  const none = c.flats.filter((f) => f.status === 'no_vehicle');
  const pending = c.flats.filter((f) => f.status === 'pending');
  const order = [...pending, ...none, ...has];
  return (
    <section>
      <SectionTitle>{t('Vehicle registration')}</SectionTitle>
      <Card className="overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
          aria-expanded={open}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-600 text-white">
            <Car className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-tight">
              {t('{{a}} of {{n}} flats have answered', { a: has.length + none.length, n: c.flats.length })}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {t('{{h}} with vehicles · {{x}} with no vehicle · {{p}} yet to answer', {
                h: has.length,
                x: none.length,
                p: pending.length,
              })}
            </p>
          </div>
          <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <>
            <ul className="divide-y border-t">
              {order.map((f) => (
                <li key={f.unit_id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-16 shrink-0 text-[13.5px] font-bold">{f.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                    {f.status === 'has_vehicles'
                      ? t('{{n}} vehicle(s)', { n: f.vehicle_count }) +
                        (f.tenant_count ? ` · ${t('{{n}} tenant', { n: f.tenant_count })}` : '')
                      : f.status === 'no_vehicle'
                        ? f.no_vehicle_at
                          ? t('Marked "no vehicle" on {{d}}', { d: formatDateTime(f.no_vehicle_at) })
                          : t('Marked "no vehicle"')
                        : t('{{n}} of 3 skips used', { n: f.skips_used })}
                  </span>
                  {f.status === 'has_vehicles' ? (
                    <Chip tone="ok">{t('Added')}</Chip>
                  ) : f.status === 'no_vehicle' ? (
                    <Chip tone="info">{t('No vehicle')}</Chip>
                  ) : (
                    <Chip tone={f.skips_used >= 3 ? 'warn' : 'wait'}>{t('Pending')}</Chip>
                  )}
                </li>
              ))}
            </ul>
            <Link to="/vehicles" className="block border-t px-4 py-3 text-center text-[13px] font-semibold text-primary">
              {t('Open the vehicle directory')}
            </Link>
          </>
        )}
      </Card>
    </section>
  );
}
