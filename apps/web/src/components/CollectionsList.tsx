import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { addMonths, currentPeriod, formatDate, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { sortCollections } from '@/lib/collections';
import { SectionTitle } from '@/components/PageHeader';
import { EventDiff, type Overview } from '@/components/EventDiff';

const PAGE = 4;

/** Open collections, last month first, with the progress bar and shortfall / surplus. More are loaded on request. */
export function CollectionsList() {
  const { t } = useTranslation();
  const m = useMember();
  const [n, setN] = useState(PAGE);
  const q = useQuery({
    queryKey: ['eventsOverview', m.societyId, 'collections'],
    queryFn: () =>
      rpc<Overview>('events_overview', { p_society: m.societyId, p_year: null, p_month: null, p_limit: 200 }),
  });
  const cur = currentPeriod();
  const rows = sortCollections(
    (q.data?.events ?? []).filter((e) => e.status === 'open'),
    cur,
    addMonths(cur, -1),
  );
  if (rows.length === 0) return null;
  return (
    <section>
      <SectionTitle
        action={
          <Link to="/events" className="text-[13px] font-semibold text-primary">
            {t('All events')}
          </Link>
        }
      >
        {t('Collections')}
      </SectionTitle>
      <div className="space-y-2.5">
        {rows.slice(0, n).map((e) => {
          const pct = Math.min(100, Math.round((e.collected_paise / Math.max(1, e.target_paise)) * 100));
          return (
            <Link
              key={e.id}
              to={`/events/${e.id}`}
              className="block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="break-words font-semibold">{e.title}</p>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {t('{{amount}} per flat · due {{date}}', {
                  amount: formatINR(e.per_unit_share_paise),
                  date: formatDate(e.due_date),
                })}
              </p>
              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="tabular mt-1.5 flex items-baseline justify-between gap-2 text-[12.5px]">
                <span>
                  <strong>{formatINR(e.collected_paise)}</strong>{' '}
                  <span className="text-muted-foreground">
                    / {formatINR(e.target_paise)} · {pct}%
                  </span>
                </span>
                <EventDiff diff={e.diff_paise} />
              </div>
            </Link>
          );
        })}
      </div>
      {rows.length > n && (
        <button
          type="button"
          className="mt-2 w-full cursor-pointer rounded-xl border bg-card py-2.5 text-center text-[13px] font-semibold text-primary"
          onClick={() => setN((v) => v + PAGE)}
        >
          {t('Load more ({{n}} more)', { n: rows.length - n })}
        </button>
      )}
    </section>
  );
}
