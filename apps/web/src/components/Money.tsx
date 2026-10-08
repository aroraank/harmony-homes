import { formatINR } from '@harmony/shared';
import { cn } from '@/lib/utils';

/** Money in tabular numerals. `tone` colours credits green / debits red, always with a +/− sign so colour is never the only cue. */
export function Money({
  paise,
  sign,
  tone,
  className,
}: {
  paise: number | null | undefined;
  sign?: boolean;
  tone?: 'auto' | 'credit' | 'debit' | 'none';
  className?: string;
}) {
  const p = Number(paise ?? 0);
  const t = tone === 'auto' ? (p > 0 ? 'credit' : p < 0 ? 'debit' : 'none') : (tone ?? 'none');
  return (
    <span className={cn('tabular whitespace-nowrap', t === 'credit' && 'text-credit', t === 'debit' && 'text-debit', className)}>
      {formatINR(p, { sign })}
    </span>
  );
}
