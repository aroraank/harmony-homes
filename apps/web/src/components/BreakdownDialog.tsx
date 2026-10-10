import { useTranslation } from 'react-i18next';
import { formatINR } from '@harmony/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Money } from '@/components/Money';

export type BreakdownRow = { label: string; sublabel?: string; amount_paise: number };

/** A simple "what makes up this total" popup — reused anywhere a stat tile needs a breakdown. */
export function BreakdownDialog({
  open,
  onOpenChange,
  title,
  rows,
  totalLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  rows: BreakdownRow[];
  totalLabel?: string;
}) {
  const { t } = useTranslation();
  const total = rows.reduce((s, r) => s + r.amount_paise, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('Nothing here.')}</p>
          ) : (
            <div className="divide-y rounded-xl border">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">{r.label}</p>
                    {r.sublabel && <p className="text-[12px] text-muted-foreground">{r.sublabel}</p>}
                  </div>
                  <Money paise={r.amount_paise} className="text-sm font-bold" />
                </div>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="mt-2 flex items-center justify-between px-1 text-sm font-bold">
              <span>{totalLabel ?? t('Total')}</span>
              <span className="tabular">{formatINR(total)}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
