import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

export interface SummaryRow {
  label: string;
  value: ReactNode;
  strong?: boolean;
}

/** Every money form shows this summary before saving. */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  rows,
  children,
  confirmLabel,
  onConfirm,
  loading,
  destructive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  rows?: SummaryRow[];
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
  destructive?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {rows && rows.length > 0 && (
          <dl className="divide-y rounded-2xl border bg-muted/40">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className={r.strong ? 'text-right text-base font-bold' : 'text-right font-medium'}>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('Go back')}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
