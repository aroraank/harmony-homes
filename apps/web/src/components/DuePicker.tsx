import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatINR, istToday } from '@harmony/shared';
import { rpc } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Field } from '@/components/Field';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

export type PendingDue = {
  due_id: string;
  label: string;
  due_type: 'monthly' | 'event';
  period: string | null;
  due_date: string;
  due_paise: number;
  already_paid_paise: number;
  remaining_paise: number;
  applying_paise: number;
  chosen: boolean;
};
export type AllocPreview = {
  allocations: { due_id: string; label: string; amount_paise: number; due_paise: number; already_paid_paise: number }[];
  advance_paise: number;
  existing_advance_paise: number;
  pending: PendingDue[];
  pending_total_paise: number;
  pending_after_paise: number;
  adjusted_paise: number;
};

/** Every open (unpaid / part paid) month or event of a flat. Paid months never appear; new months appear as soon as they are generated. */
export function usePendingDues(unitId: string, fundId: string | undefined) {
  return useQuery({
    queryKey: ['preview', 'pending', unitId, fundId],
    enabled: !!unitId && !!fundId,
    staleTime: 0,
    queryFn: () => rpc<AllocPreview>('preview_allocation', { p_unit_id: unitId, p_amount_paise: 0, p_fund_id: fundId }),
  });
}

export function sumRemaining(dues: PendingDue[] | undefined, ids: string[]): number {
  return (dues ?? []).filter((d) => ids.includes(d.due_id)).reduce((s, d) => s + d.remaining_paise, 0);
}

export function DuePicker({
  dues,
  loading,
  selected,
  onChange,
}: {
  dues: PendingDue[] | undefined;
  loading?: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const today = istToday();
  const list = dues ?? [];
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <Field
      label={t('For which month?')}
      hint={
        list.length === 0
          ? undefined
          : selected.length === 0
            ? t('Tick the months this payment is for. If you tick nothing, the oldest pending month is settled first.')
            : t('{{n}} selected — {{a}} pending', { n: selected.length, a: formatINR(sumRemaining(list, selected)) })
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      ) : list.length === 0 ? (
        <p className="rounded-2xl border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">{t('Nothing pending — anything paid now is kept as advance for future months.')}</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3.5 py-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">{t('{{n}} open', { n: list.length })}</span>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => onChange(list.map((d) => d.due_id))}>
                {t('Select all')}
              </Button>
              {selected.length > 0 && (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => onChange([])}>
                  {t('Clear')}
                </Button>
              )}
            </div>
          </div>
          <div className="max-h-72 divide-y overflow-y-auto">
            {list.map((d) => {
              const on = selected.includes(d.due_id);
              return (
                <label key={d.due_id} className={cn('flex min-h-[54px] cursor-pointer items-center gap-3 px-3.5 py-2.5', on && 'bg-secondary/60')}>
                  <Checkbox checked={on} onCheckedChange={(v) => toggle(d.due_id, v === true)} aria-label={d.label} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.label}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {t('due')} {formatDate(d.due_date)}
                      {d.due_date < today && <span className="font-semibold text-debit"> · {t('Overdue')}</span>}
                      {d.already_paid_paise > 0 && ` · ${t('{{a}} already paid', { a: formatINR(d.already_paid_paise) })}`}
                    </p>
                  </div>
                  <span className="tabular text-sm font-bold">{formatINR(d.remaining_paise)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </Field>
  );
}
