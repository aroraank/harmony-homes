import * as React from 'react';
import { Input } from '@/components/ui/input';

/** Whole-number field (day of month, counts…): digits only, never negative, no decimals, no "e". */
export const IntInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { max?: number }>(
  ({ onChange, max, ...props }, ref) => (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      maxLength={max ? String(max).length : 6}
      onChange={(e) => {
        let clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
        if (max && Number(clean) > max) clean = String(max);
        if (clean !== e.target.value) e.target.value = clean;
        onChange?.(e);
      }}
      {...props}
    />
  ),
);
IntInput.displayName = 'IntInput';
