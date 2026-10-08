import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarHeart, ChevronRight, Plus } from 'lucide-react';
import { formatDate, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { useDashboard, useEvents } from '@/lib/queries';
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
  const collected = (id: string) => dash.data?.events.find((e) => e.id === id)?.collected_paise;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Events')}
        subtitle={t('Special collections like repairs, shared by the flats involved')}
        actions={
          m.can('manage_events') && (
            <Button asChild size="sm">
              <Link to="/events/new">
                <Plus /> {t('New')}
              </Link>
            </Button>
          )
        }
      />
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
        {(events) => {
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
