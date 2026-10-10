import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  hint,
  icon,
  className,
  tone = 'default',
  onBreakdown,
  breakdownLabel,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
  tone?: 'default' | 'good' | 'bad' | 'warn';
  /** When provided, shows a small green breakdown button that calls this on click. */
  onBreakdown?: () => void;
  breakdownLabel?: string;
}) {
  return (
    <div className={cn('relative rounded-2xl border bg-card p-3.5 shadow-card', className)}>
      {onBreakdown && (
        <button
          type="button"
          onClick={onBreakdown}
          aria-label={breakdownLabel ?? 'View breakdown'}
          className="absolute right-2.5 top-2.5 grid size-6 place-items-center rounded-full bg-emerald-600 text-white shadow-sm transition-transform hover:scale-105"
        >
          <Plus className="size-3.5" />
        </button>
      )}
      <div className="flex items-center gap-2 pr-6 text-[12px] font-semibold text-muted-foreground">
        {icon && <span className="text-primary [&_svg]:size-4">{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'tabular mt-1.5 text-xl font-extrabold tracking-tight',
          tone === 'good' && 'text-credit',
          tone === 'bad' && 'text-debit',
          tone === 'warn' && 'text-warning',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
