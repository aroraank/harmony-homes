import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A tappable row (≥ 56px tall) used across lists. */
export function ListRow({
  to,
  onClick,
  icon,
  title,
  subtitle,
  right,
  className,
  chevron = true,
}: {
  to?: string;
  onClick?: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {icon && (
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="break-words text-[14.5px] font-semibold">{title}</div>
        {subtitle && <div className="break-words text-[12.5px] text-muted-foreground">{subtitle}</div>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
      {(to || onClick) && chevron && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
    </>
  );
  const cls = cn(
    'flex min-h-[60px] w-full items-center gap-3 rounded-2xl border bg-card px-3.5 py-2.5 text-left shadow-card transition-colors',
    (to || onClick) && 'cursor-pointer hover:bg-secondary/60 active:scale-[0.995]',
    className,
  );
  if (to)
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}
