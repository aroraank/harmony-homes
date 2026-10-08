import * as React from 'react';
import { normalizeMobile } from '@harmony/shared';
import { Input } from '@/components/ui/input';

/** Keep only digits, at most 10. A pasted "+91 98765 43210" becomes 9876543210. */
export function sanitizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10) d = normalizeMobile(d);
  return d.slice(0, 10);
}

/** Indian mobile number field: digits only, never more than 10, numeric keypad on phones. */
export const PhoneInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ onChange, ...props }, ref) => (
    <Input
      ref={ref}
      type="tel"
      inputMode="numeric"
      maxLength={14}
      autoComplete="tel-national"
      pattern="[6-9][0-9]{9}"
      onChange={(e) => {
        const clean = sanitizePhone(e.target.value);
        if (clean !== e.target.value) e.target.value = clean;
        onChange?.(e);
      }}
      {...props}
    />
  ),
);
PhoneInput.displayName = 'PhoneInput';
