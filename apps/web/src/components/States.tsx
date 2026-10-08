import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { errorMessage } from '@/lib/supabase';

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center animate-fade-up">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-secondary text-primary">{icon ?? <Inbox className="size-7" />}</div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <p className="font-semibold">{t('Could not load this')}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          <RefreshCw /> {t('Try again')}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-3.5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className = 'h-32' }: { className?: string }) {
  return <Skeleton className={`w-full rounded-2xl ${className}`} />;
}

/** Renders loading / error / empty / content for a query in one place */
export function QueryState<T>({
  query,
  empty,
  skeleton,
  children,
}: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (data: T) => ReactNode | null;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading && query.data === undefined) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.error && query.data === undefined) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  const e = empty?.(query.data);
  if (e) return <>{e}</>;
  return <>{children(query.data)}</>;
}
