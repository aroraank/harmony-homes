import type { OverviewEvent } from '@/components/EventDiff';

/**
 * Order for the collections list: the month being collected right now (last month) first, then this month's,
 * then anything later, then older months newest first. Inside a month the recurring event comes before one-off events.
 */
export function sortCollections(list: OverviewEvent[], current: string, previous: string): OverviewEvent[] {
  const bucket = (e: OverviewEvent) => (e.period === previous ? 0 : e.period === current ? 1 : e.period > current ? 2 : 3);
  return [...list].sort((a, b) => {
    const ba = bucket(a);
    const bb = bucket(b);
    if (ba !== bb) return ba - bb;
    if (ba === 3 && a.period !== b.period) return b.period.localeCompare(a.period);
    if (a.period !== b.period) return a.period.localeCompare(b.period);
    const sa = a.series_id ? 0 : 1;
    const sb = b.series_id ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title);
  });
}
