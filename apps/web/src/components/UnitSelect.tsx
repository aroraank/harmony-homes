import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from './ui/input';
import type { Unit } from '@/types';

/** Native select of units, grouped by block when blocks exist. */
export const UnitSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { units: Unit[]; blocks?: Record<string, string>; placeholder?: string }
>(({ units, blocks, placeholder, ...props }, ref) => {
  const { t } = useTranslation();
  const groups = new Map<string, Unit[]>();
  for (const u of units) {
    const g = (u.block_id && blocks?.[u.block_id]) || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(u);
  }
  return (
    <NativeSelect ref={ref} {...props}>
      <option value="">{placeholder ?? t('Choose flat…')}</option>
      {[...groups.entries()].map(([g, list]) =>
        g ? (
          <optgroup key={g} label={g}>
            {list.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.display_name}
              </option>
            ))}
          </optgroup>
        ) : (
          list.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} — {u.display_name}
            </option>
          ))
        ),
      )}
    </NativeSelect>
  );
});
UnitSelect.displayName = 'UnitSelect';
