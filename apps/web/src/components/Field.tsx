import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from './ui/label';
import { cn } from '@/lib/utils';

const CONTROL_NAMES = ['Input', 'Textarea', 'NativeSelect', 'UnitSelect'];

function isDirectControl(el: ReactElement): boolean {
  const t = el.type as string | { displayName?: string };
  if (typeof t === 'string') return ['input', 'select', 'textarea'].includes(t);
  return CONTROL_NAMES.includes(t?.displayName ?? '');
}

/** Label + control + hint/error, wired up for screen readers (also when the control is wrapped, e.g. a ₹ prefix). */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactElement;
  className?: string;
  optional?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const direct = isValidElement(children) && isDirectControl(children);

  useLayoutEffect(() => {
    if (direct || !box.current) return;
    const el = box.current.querySelector<HTMLElement>('input:not([type=file]), select, textarea');
    if (!el) return;
    el.id = id;
    if (describedBy) el.setAttribute('aria-describedby', describedBy);
    else el.removeAttribute('aria-describedby');
    if (error) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  });

  const control = direct
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;
  return (
    <div ref={box} className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted-foreground">({t('optional')})</span>}
      </Label>
      {control}
      {error ? (
        <p id={`${id}-err`} className="text-[13px] font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[12.5px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
