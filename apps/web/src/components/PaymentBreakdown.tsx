import { useTranslation } from 'react-i18next';
import { formatINR } from '@harmony/shared';
import { cn } from '@/lib/utils';
import type { AllocPreview } from '@/components/DuePicker';

/** "What exactly happens" — shown in the confirmation dialog of every payment. */
export function PaymentBreakdown({ preview, amountPaise }: { preview: AllocPreview | undefined; amountPaise: number }) {
  const { t } = useTranslation();
  if (!preview) return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  const rows = preview.pending;
  return (
    <div className="space-y-3 text-sm">
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-[11.5px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">{t('Pending')}</th>
                <th className="px-2 py-2 text-right font-semibold">{t('Owed')}</th>
                <th className="px-2 py-2 text-right font-semibold">{t('Paying')}</th>
                <th className="px-3 py-2 text-right font-semibold">{t('Left')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((d) => (
                <tr key={d.due_id} className={cn(d.applying_paise > 0 && 'bg-secondary/50')}>
                  <td className="px-3 py-2 font-medium">{d.label}</td>
                  <td className="tabular px-2 py-2 text-right">{formatINR(d.remaining_paise)}</td>
                  <td className="tabular px-2 py-2 text-right font-semibold text-credit">{d.applying_paise > 0 ? formatINR(d.applying_paise) : '—'}</td>
                  <td className="tabular px-3 py-2 text-right font-semibold">{formatINR(d.remaining_paise - d.applying_paise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-muted/40 font-bold">
              <tr>
                <td className="px-3 py-2">{t('Total')}</td>
                <td className="tabular px-2 py-2 text-right">{formatINR(preview.pending_total_paise)}</td>
                <td className="tabular px-2 py-2 text-right text-credit">{formatINR(amountPaise - preview.advance_paise)}</td>
                <td className="tabular px-3 py-2 text-right">{formatINR(preview.pending_after_paise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <dl className="divide-y rounded-2xl border bg-muted/40">
        <div className="flex justify-between gap-4 px-4 py-2">
          <dt className="text-muted-foreground">{t('This payment')}</dt>
          <dd className="tabular font-bold">{formatINR(amountPaise)}</dd>
        </div>
        <div className="flex justify-between gap-4 px-4 py-2">
          <dt className="text-muted-foreground">{t('Pending after this payment')}</dt>
          <dd className="tabular font-bold">{formatINR(preview.pending_after_paise)}</dd>
        </div>
        {preview.advance_paise > 0 && (
          <div className="flex justify-between gap-4 px-4 py-2">
            <dt className="text-muted-foreground">{t('Surplus kept as advance')}</dt>
            <dd className="tabular font-bold text-credit">{formatINR(preview.advance_paise)}</dd>
          </div>
        )}
      </dl>
      {preview.adjusted_paise > 0 && (
        <p className="rounded-xl bg-secondary px-3 py-2 text-[12.5px]">
          {t('{{a}} is more than the months chosen, so it is adjusted against your older pending months.', { a: formatINR(preview.adjusted_paise) })}
        </p>
      )}
      {preview.advance_paise > 0 && (
        <p className="rounded-xl bg-secondary px-3 py-2 text-[12.5px]">
          {t('Everything pending is cleared. The surplus is kept as advance and adjusted against future dues. The admin and super admin are notified.')}
        </p>
      )}
    </div>
  );
}
