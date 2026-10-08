import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarHeart, ChevronRight, Plus, Repeat } from 'lucide-react';
import { formatDate, formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { useDashboard, useEvents } from '@/lib/queries';
import { rpc } from '@/lib/supabase';
import { EventDiff, type Overview } from '@/components/EventDiff';
import { NativeSelect } from '@/components/ui/input';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { EventRow } from '@/types';

export default function EventsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useEvents(m.societyId);
  const dash = useDashboard(m.societyId);
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [kind, setKind] = useState<'all' | 'recurring' | 'one'>('all');
  const ov = useQuery({
    queryKey: ['eventsOverview', m.societyId, year, month],
    queryFn: () => rpc<Overview>('events_overview', { p_society: m.societyId, p_year: year ? Number(year) : null, p_month: month ? Number(month) : null, p_limit: 200 }),
  });
  const years = [...new Set((ov.data?.periods ?? []).map((p) => p.slice(0, 4)))];
  const byId = new Map((ov.data?.events ?? []).map((e) => [e.id, e]));
  const filtered = !!(year || month);
  const collected = (id: string) => dash.data?.events.find((e) => e.id === id)?.collected_paise;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Events')}
        subtitle={t('Special collections like repairs, shared by the flats involved')}
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/events/recurring">
                <Repeat /> {t('Recurring')}
              </Link>
            </Button>
            {m.can('manage_events') && (
              <Button asChild size="sm">
                <Link to="/events/new">
                  <Plus /> {t('New')}
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <NativeSelect aria-label={t('Year')} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">{t('All years')}</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label={t('Month')} value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">{t('All months')}</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i + 1}>
              {periodLabel(`2026-${String(i + 1).padStart(2, '0')}`, true).split(' ')[0]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="mb-3 flex gap-2">
        {([['all', 'All events'], ['recurring', 'Recurring'], ['one', 'One-time']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-bold ${kind === k ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}>
            {t(l)}
          </button>
        ))}
      </div>
      <QueryState
        query={q}
        empty={(d) =>
          d.length ? null : (
            <EmptyState
              icon={<CalendarHeart className="size-7" />}
              title={t('No events yet')}
              hint={t('Create one when a big expense must be shared, e.g. a motor repair.')}
            />
          )
        }
      >
        {(all) => {
          const base = filtered ? all.filter((e) => byId.has(e.id)) : all;
          const isRec = (id: string) => !!(byId.get(id) as { series_id?: string | null } | undefined)?.series_id;
          const events = kind === 'all' ? base : base.filter((e) => (kind === 'recurring') === isRec(e.id));
          if (events.length === 0) return <EmptyState icon={<CalendarHeart className="size-7" />} title={t('No events in this month')} />;
          const groups: [string, EventRow[]][] = [
            [t('Open'), events.filter((e) => e.status === 'open')],
            [t('Drafts'), events.filter((e) => e.status === 'draft')],
            [t('Closed'), events.filter((e) => e.status === 'closed')],
          ];
          return groups
            .filter(([, l]) => l.length)
            .map(([label, list]) => (
              <section key={label}>
                <SectionTitle>{label}</SectionTitle>
                <div className="space-y-2.5">
                  {list.map((e) => {
                    const c = collected(e.id);
                    const pct = c !== undefined ? Math.min(100, Math.round((c / Math.max(1, e.total_cost_paise)) * 100)) : null;
                    return (
                      <Link key={e.id} to={`/events/${e.id}`} className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-bold">{e.title}</p>
                            {(byId.get(e.id) as { series_id?: string | null } | undefined)?.series_id && (
                              <span className="mb-0.5 inline-block rounded-full bg-lime-100 px-2 py-px text-[10.5px] font-bold uppercase text-lime-800 dark:bg-lime-500/15 dark:text-lime-300">{t('Recurring')}</span>
                            )}
                            <p className="text-[12.5px] text-muted-foreground">
                              {formatINR(e.total_cost_paise)} · {t('{{n}} flats × {{a}}', { n: e.expected_count, a: formatINR(e.per_unit_share_paise) })}
                            </p>
                            <p className="text-[12px] text-muted-foreground">{t('Due {{d}}', { d: formatDate(e.due_date) })}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={e.status === 'open' ? 'success' : e.status === 'draft' ? 'warning' : 'muted'}>{t(e.status === 'open' ? 'Open' : e.status === 'draft' ? 'Draft' : 'Closed')}</Badge>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </div>
                        {byId.get(e.id) && e.status !== 'draft' && (
                          <p className="mt-2">
                            <EventDiff diff={byId.get(e.id)!.diff_paise} />
                          </p>
                        )}
                        {pct !== null && (
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </section>
            ));
        }}
      </QueryState>
    </div>
  );
}
