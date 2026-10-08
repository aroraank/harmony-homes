import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronRight, Plus, Users } from 'lucide-react';
import { formatDate } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { useMeetings } from '@/lib/queries';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Meeting } from '@/types';

function timeLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function MeetingsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useMeetings(m.societyId);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Meetings')}
        subtitle={t('Society meetings, who needs to attend and the agenda')}
        actions={
          m.can('manage_meetings') && (
            <Button asChild size="sm">
              <Link to="/meetings/new">
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
            <EmptyState icon={<CalendarClock className="size-7" />} title={t('No meetings yet')} hint={t('Call one when the society needs to decide something together.')} />
          )
        }
      >
        {(all) => {
          const upcoming = all.filter((x) => x.status === 'published' && x.meeting_date >= new Date().toISOString().slice(0, 10));
          const past = all.filter((x) => x.status === 'published' && x.meeting_date < new Date().toISOString().slice(0, 10));
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
                    <Link key={x.id} to={`/meetings/${x.id}`} className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-bold">{x.title}</p>
                          <p className="text-[12.5px] text-muted-foreground">
                            {formatDate(x.meeting_date)} · {timeLabel(x.start_time)}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
                            <Users className="size-3" /> {x.audience_label}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant={x.status === 'draft' ? 'warning' : x.status === 'cancelled' ? 'muted' : 'success'}>
                            {t(x.status === 'draft' ? 'Draft' : x.status === 'cancelled' ? 'Cancelled' : 'Published')}
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
    </div>
  );
}
