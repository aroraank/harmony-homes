import * as React from 'react';
import { Input } from '@/components/ui/input';

/** Keep only what can be a rupee amount: digits and one dot, at most 2 decimals, never negative. */
export function sanitizeAmount(raw: string): string {
  let s = raw.replace(/[₹,\s]/g, '').replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return s.replace(/^0+(?=\d)/, '');
}

/** Drop-in for <Input inputMode="decimal">: same props, but typing/pasting a minus sign, letters or a 3rd decimal is ignored. */
export const AmountInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ onChange, ...props }, ref) => (
    <Input
      ref={ref}
      inputMode="decimal"
      autoComplete="off"
      onChange={(e) => {
        const clean = sanitizeAmount(e.target.value);
        if (clean !== e.target.value) e.target.value = clean;
        onChange?.(e);
      }}
      {...props}
    />
  ),
);
AmountInput.displayName = 'AmountInput';
