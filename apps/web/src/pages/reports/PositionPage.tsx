import { useTranslation } from 'react-i18next';
import { useMember } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { PositionShare, SocietyPosition, buildOverall, usePosition } from '@/components/SocietyPosition';

/** Full society position: every fund's balance, yet to collect and advance, with PDF / WhatsApp sharing. */
export default function PositionPage() {
  const { t } = useTranslation();
  const m = useMember();
  const q = usePosition();
  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Society position')}
        subtitle={t('Balance, yet to collect and advance — for every fund')}
        back="/reports"
      />
      {q.isLoading && !q.data ? (
        <CardSkeleton className="h-64" />
      ) : !q.data ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-3">
          <PositionShare p={q.data} overall={buildOverall(q.data, m.isAdmin, t('Earlier months'))} />
          <SocietyPosition expanded hideTitle withBreakdown />
        </div>
      )}
    </div>
  );
}
