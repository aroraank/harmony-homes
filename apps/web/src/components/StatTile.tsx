import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  hint,
  icon,
  className,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
  tone?: 'default' | 'good' | 'bad' | 'warn';
}) {
  return (
    <div className={cn('rounded-2xl border bg-card p-3.5 shadow-card', className)}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground">
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
