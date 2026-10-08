import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { SectionTitle } from '@/components/PageHeader';
import { EventDiff, type Overview } from '@/components/EventDiff';

/** The last 3 events with how much was collected against the target: green surplus, red shortfall, grey when met. */
export function RecentEvents() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useQuery({ queryKey: ['eventsOverview', m.societyId, 'recent'], queryFn: () => rpc<Overview>('events_overview', { p_society: m.societyId, p_year: null, p_month: null, p_limit: 3 }) });
  const rows = (q.data?.events ?? []).filter((e) => e.status !== 'draft');
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionTitle action={<Link to="/events" className="text-[13px] font-semibold text-primary">{t('All events')}</Link>}>{t('Recent events')}</SectionTitle>
      <Card className="divide-y">
        {rows.map((e) => (
          <Link key={e.id} to={`/events/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
            <span className={cn('h-10 w-1.5 shrink-0 rounded-full', e.diff_paise > 0 ? 'bg-emerald-500' : e.diff_paise < 0 ? 'bg-rose-500' : 'bg-muted-foreground/40')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{e.title}</p>
              <p className="tabular text-[12px] text-muted-foreground">
                {periodLabel(e.period)} · {formatINR(e.collected_paise)} / {formatINR(e.target_paise)}
              </p>
              <EventDiff diff={e.diff_paise} />
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </Card>
    </section>
  );
}
