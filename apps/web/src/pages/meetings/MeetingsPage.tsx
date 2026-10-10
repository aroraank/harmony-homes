import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarHeart, ChevronRight, Plus, Users } from 'lucide-react';
import { formatDate, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { useEvents, useMeetings } from '@/lib/queries';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { EventRow, Meeting } from '@/types';

function timeLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function MeetingsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const [tab, setTab] = useState<'meetings' | 'events'>('meetings');
  const meetings = useMeetings(m.societyId);
  const events = useEvents(m.societyId);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Meetings')}
        subtitle={t('Society meetings and events, all in one place')}
        actions={
          tab === 'meetings' &&
          m.can('manage_meetings') && (
            <Button asChild size="sm">
              <Link to="/meetings/new">
                <Plus /> {t('New')}
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1" role="tablist">
        {(
          [
            ['meetings', t('Meetings')],
            ['events', t('Events')],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`cursor-pointer rounded-xl py-2.5 text-[13.5px] font-bold transition-colors ${tab === k ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'meetings' ? (
        <QueryState
          query={meetings}
          empty={(d) =>
            d.length ? null : (
              <EmptyState
                icon={<CalendarClock className="size-7" />}
                title={t('No meetings yet')}
                hint={t('Call one when the society needs to decide something together.')}
              />
            )
          }
        >
          {(all) => {
            const upcoming = all.filter(
              (x) => x.status === 'published' && x.meeting_date >= new Date().toISOString().slice(0, 10),
            );
            const past = all.filter(
              (x) => x.status === 'published' && x.meeting_date < new Date().toISOString().slice(0, 10),
            );
            const drafts = all.filter((x) => x.status === 'draft');
            const cancelled = all.filter((x) => x.status === 'cancelled');
            const groups: [string, Meeting[]][] = [
              [t('Upcoming'), upcoming],
              [t('Drafts'), drafts],
              [t('Past'), past],
              [t('Cancelled'), cancelled],
            ];
            return groups
              .filter(([, l]) => l.length)
              .map(([label, list]) => (
                <section key={label}>
                  <SectionTitle>{label}</SectionTitle>
                  <div className="space-y-2.5">
                    {list.map((x) => (
                      <Link
                        key={x.id}
                        to={`/meetings/${x.id}`}
                        className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words font-bold">{x.title}</p>
                            <p className="text-[12.5px] text-muted-foreground">
                              {formatDate(x.meeting_date)} · {timeLabel(x.start_time)}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                              <Users className="size-3" /> {x.audience_label}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge
                              variant={
                                x.status === 'draft'
                                  ? 'warning'
                                  : x.status === 'cancelled'
                                    ? 'muted'
                                    : 'success'
                              }
                            >
                              {t(
                                x.status === 'draft'
                                  ? 'Draft'
                                  : x.status === 'cancelled'
                                    ? 'Cancelled'
                                    : 'Published',
                              )}
                            </Badge>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ));
          }}
        </QueryState>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted-foreground">
              {t('Special collections like repairs, shared by the flats involved')}
            </p>
            <Link to="/events" className="shrink-0 text-[12.5px] font-bold text-primary">
              {t('Filters & more')} →
            </Link>
          </div>
          <QueryState
            query={events}
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
              const groups: [string, EventRow[]][] = [
                [t('Open'), all.filter((e) => e.status === 'open')],
                [t('Drafts'), all.filter((e) => e.status === 'draft')],
                [t('Closed'), all.filter((e) => e.status === 'closed')],
              ];
              return groups
                .filter(([, l]) => l.length)
                .map(([label, list]) => (
                  <section key={label}>
                    <SectionTitle>{label}</SectionTitle>
                    <div className="space-y-2.5">
                      {list.map((e) => (
                        <Link
                          key={e.id}
                          to={`/events/${e.id}`}
                          className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words font-bold">{e.title}</p>
                              <p className="text-[12.5px] text-muted-foreground">
                                {formatINR(e.total_cost_paise)} ·{' '}
                                {t('{{n}} flats × {{a}}', {
                                  n: e.expected_count,
                                  a: formatINR(e.per_unit_share_paise),
                                })}
                              </p>
                              <p className="text-[12px] text-muted-foreground">
                                {t('Due {{d}}', { d: formatDate(e.due_date) })}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge
                                variant={
                                  e.status === 'open' ? 'success' : e.status === 'draft' ? 'warning' : 'muted'
                                }
                              >
                                {t(e.status === 'open' ? 'Open' : e.status === 'draft' ? 'Draft' : 'Closed')}
                              </Badge>
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                ));
            }}
          </QueryState>
        </>
      )}
    </div>
  );
}
