import { useEffect, useRef } from 'react';
import { periodLabel } from '@harmony/shared';
import { cn } from '@/lib/utils';

/** Horizontally scrollable month picker; the selected chip scrolls into view. */
export function MonthChips({ periods, value, onChange }: { periods: string[]; value: string; onChange: (p: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLButtonElement>('[data-active="true"]');
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [value]);
  return (
    <div ref={ref} role="tablist" aria-label="Month" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
      {periods.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === value}
          data-active={p === value}
          onClick={() => onChange(p)}
          className={cn(
            'h-10 shrink-0 cursor-pointer rounded-full border px-4 text-[13px] font-semibold transition-colors',
            p === value ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-card text-foreground/80 hover:bg-secondary',
          )}
        >
          {periodLabel(p)}
        </button>
      ))}
    </div>
  );
}
