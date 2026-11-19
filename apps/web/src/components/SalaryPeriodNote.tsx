import { useTranslation } from 'react-i18next';
import { servicePeriod } from '@/lib/fixedExpenses';

/** Small bold yellow-highlighted line telling the admin which dates this payment covers. */
export function SalaryPeriodNote({ period, className = '' }: { period: string; className?: string }) {
  const { t } = useTranslation();
  const p = servicePeriod(period);
  return (
    <p data-testid="salary-period" className={`text-[12.5px] font-bold ${className}`}>
      <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-yellow-950 dark:bg-yellow-400 dark:text-yellow-950">
        {t('Salary for the period {{from}} to {{to}}', { from: p.from, to: p.to })}
      </span>
    </p>
  );
}
