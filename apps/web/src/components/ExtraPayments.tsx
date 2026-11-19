import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, HandCoins, Search, X } from 'lucide-react';
import { formatINR, paiseToInput, parseRupeesToPaise } from '@harmony/shared';
import { MODE_LABELS } from '@/lib/utils';
import { MODE_NEEDS_REF, splitEqually, type Contribution } from '@/lib/fixedExpenses';
import type { Unit } from '@/types';
import { AmountInput } from './AmountInput';
import { Button } from './ui/button';
import { Input, NativeSelect } from './ui/input';
import { cn } from '@/lib/utils';

export const contributionPaise = (c: Contribution) => parseRupeesToPaise(c.amount) ?? 0;
export const contributionsTotal = (list: Contribution[]) => list.reduce((s, c) => s + contributionPaise(c), 0);

/**
 * Easy way to record which flats paid extra to cover a short-fall:
 * 1) tap the flats, 2) "Split equally" or type each amount, 3) see how much is still missing.
 */
export function ExtraPayments({
  units,
  shortfallPaise,
  value,
  onChange,
  mode,
  onModeChange,
}: {
  units: Unit[];
  shortfallPaise: number;
  value: Contribution[];
  onChange: (v: Contribution[]) => void;
  mode: string;
  onModeChange: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const flats = useMemo(() => units.filter((u) => u.is_billable), [units]);
  const selected = new Set(value.map((c) => c.unit_id));
  const total = contributionsTotal(value);
  const left = Math.max(0, shortfallPaise - total);
  const shown = flats.filter((u) => !q || u.code.toLowerCase().includes(q.toLowerCase()) || (u.display_name ?? '').toLowerCase().includes(q.toLowerCase()));
  const byId = new Map(units.map((u) => [u.id, u]));

  const toggle = (id: string) =>
    onChange(selected.has(id) ? value.filter((c) => c.unit_id !== id) : [...value, { unit_id: id, amount: '', ref: '' }]);
  const patch = (id: string, p: Partial<Contribution>) => onChange(value.map((c) => (c.unit_id === id ? { ...c, ...p } : c)));
  const split = () => {
    const parts = splitEqually(shortfallPaise, value.length);
    onChange(value.map((c, i) => ({ ...c, amount: paiseToInput(parts[i] ?? 0) })));
  };

  return (
    <div className="space-y-3 rounded-2xl border-2 border-amber-300 bg-amber-50/70 p-3.5 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="extra-payments">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
          <HandCoins className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-bold leading-snug">{t('Add extra payments from flats')}</p>
          <p className="text-[13px] text-muted-foreground">
            {t('Balance is short by {{s}}. Tap the flats that paid extra, then enter how much each paid.', { s: formatINR(shortfallPaise) })}
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search flat…')} aria-label={t('Search flat…')} />
      </div>
      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" role="group" aria-label={t('Flats')}>
        {shown.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => toggle(u.id)}
            aria-pressed={selected.has(u.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition',
              selected.has(u.id) ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-secondary',
            )}
          >
            {selected.has(u.id) && <Check className="size-3.5" />}
            {u.code}
          </button>
        ))}
        {!shown.length && <p className="text-[13px] text-muted-foreground">{t('No flat found.')}</p>}
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <NativeSelect value={mode} onChange={(e) => onModeChange(e.target.value)} aria-label={t('Mode')}>
              {Object.entries(MODE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v)}
                </option>
              ))}
            </NativeSelect>
            <Button type="button" variant="outline" onClick={split} disabled={shortfallPaise <= 0}>
              {t('Split equally')}
            </Button>
          </div>
          {value.map((c) => {
            const u = byId.get(c.unit_id);
            return (
              <div key={c.unit_id} className="flex items-center gap-2 rounded-xl border bg-card p-2" data-testid={`extra-${u?.code}`}>
                <div className="w-16 shrink-0">
                  <p className="text-sm font-bold">{u?.code}</p>
                </div>
                <div className="relative min-w-0 flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">₹</span>
                  <AmountInput
                    value={c.amount}
                    onChange={(e) => patch(c.unit_id, { amount: e.target.value })}
                    className="tabular h-10 pl-6 font-bold"
                    aria-label={t('Amount from {{f}}', { f: u?.code ?? '' })}
                  />
                </div>
                {MODE_NEEDS_REF(mode) && (
                  <Input
                    className="h-10 w-28"
                    value={c.ref}
                    onChange={(e) => patch(c.unit_id, { ref: e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 30) })}
                    placeholder={t('UTR')}
                    aria-label={t('UTR for {{f}}', { f: u?.code ?? '' })}
                  />
                )}
                <button type="button" onClick={() => toggle(c.unit_id)} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-secondary" aria-label={t('Remove {{f}}', { f: u?.code ?? '' })}>
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div
        className={cn(
          'flex items-center justify-between rounded-xl px-3 py-2 text-sm font-bold',
          left === 0 && total > 0 ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100' : 'bg-card',
        )}
        data-testid="extra-progress"
      >
        <span>{t('Added {{a}} of {{n}} needed', { a: formatINR(total), n: formatINR(shortfallPaise) })}</span>
        <span>{left === 0 && total > 0 ? t('Covered') : t('{{l}} left', { l: formatINR(left) })}</span>
      </div>
    </div>
  );
}
