import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: boolean | string;
  actions?: ReactNode;
  className?: string;
}) {
  const nav = useNavigate();
  const { t } = useTranslation();
  return (
    <div className={cn('mb-4 flex items-center gap-2', className)}>
      {back && (
        <button
          type="button"
          onClick={() =>
            typeof back === 'string' ? nav(back) : window.history.length > 1 ? nav(-1) : nav('/')
          }
          className="-ml-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-secondary"
          aria-label={t('Back')}
        >
          <ArrowLeft className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-[22px] font-extrabold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="break-words text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-0.5">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}
