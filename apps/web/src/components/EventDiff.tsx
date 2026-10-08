import { useTranslation } from 'react-i18next';
import { formatINR } from '@harmony/shared';
import { cn } from '@/lib/utils';

export type OverviewEvent = {
  id: string; title: string; status: 'draft' | 'open' | 'closed'; period: string; due_date: string;
  target_paise: number; collected_paise: number; diff_paise: number; per_unit_share_paise: number; expected_count: number; series_id: string | null;
};
export type Overview = { events: OverviewEvent[]; periods: string[] };

/** Collected minus target: green when ahead (surplus), red when short, neutral when exactly met. */
export function EventDiff({ diff, className }: { diff: number; className?: string }) {
  const { t } = useTranslation();
  const tone = diff > 0 ? 'text-credit' : diff < 0 ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={cn('tabular text-[12.5px] font-bold', tone, className)}>
      {diff > 0 ? t('Surplus {{a}}', { a: formatINR(diff) }) : diff < 0 ? t('Shortfall {{a}}', { a: formatINR(-diff) }) : t('Fully collected')}
    </span>
  );
}
