import { z } from 'zod';
import { MAX_ENTRY_PAISE, parseRupeesToPaise } from './money';
import { istToday } from './period';

/** Shared validation rules. The same checks are enforced again inside the database RPCs. */

export const NAME_RE = /^[A-Za-z][A-Za-z .']{1,59}$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const UTR_RE = /^[A-Z0-9]{6,30}$/;
export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,255}@[a-zA-Z]{2,64}$/;
export const UNIT_CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,19}$/;
export const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,39}$/;

/** "+91 98765 43210", "098765 43210" -> "9876543210" (or the stripped digits if invalid) */
export function normalizeMobile(input: string): string {
  let v = (input ?? '').replace(/\D/g, '');
  if (v.length === 12 && v.startsWith('91')) v = v.slice(2);
  if (v.length === 11 && v.startsWith('0')) v = v.slice(1);
  return v;
}

export function normalizeUtr(input: string): string {
  return (input ?? '').replace(/\s/g, '').toUpperCase();
}

export function normalizeName(input: string): string {
  return (input ?? '').trim();
}

export const personNameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s.length >= 2 && s.length <= 60, 'Name must be 2–60 characters')
  .refine((s) => !/\s{2,}/.test(s), 'Remove the extra spaces')
  .refine((s) => NAME_RE.test(s), 'Use letters, spaces, dot (.) and apostrophe (\') only');

export const mobileSchema = z
  .string()
  .transform(normalizeMobile)
  .refine((s) => MOBILE_RE.test(s), 'Enter a valid 10-digit Indian mobile number');

export const optionalMobileSchema = z
  .string()
  .optional()
  .transform((s) => (s ? normalizeMobile(s) : ''))
  .refine((s) => s === '' || MOBILE_RE.test(s), 'Enter a valid 10-digit Indian mobile number');

/** Rupee input string -> paise number (positive, ≤ ₹1 crore, ≤ 2 decimals) */
export const amountSchema = z
  .string()
  .min(1, 'Amount is required')
  .transform((s, ctx) => {
    const p = parseRupeesToPaise(s);
    if (p === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 800 or 800.50' });
      return z.NEVER;
    }
    if (p > MAX_ENTRY_PAISE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Maximum ₹1,00,00,000 per entry' });
      return z.NEVER;
    }
    return p;
  });

export const utrSchema = z
  .string()
  .transform(normalizeUtr)
  .refine((s) => UTR_RE.test(s), 'UTR / reference must be 6–30 letters or digits');

export const optionalUtrSchema = z
  .string()
  .optional()
  .transform((s) => (s ? normalizeUtr(s) : ''))
  .refine((s) => s === '' || UTR_RE.test(s), 'UTR / reference must be 6–30 letters or digits');

export const upiIdSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => UPI_RE.test(s), 'Enter a valid UPI ID, e.g. society@okhdfcbank');

export const pastOrTodaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
  .refine((d) => d <= istToday(), 'Date cannot be in the future');

export const paymentModes = ['upi', 'gpay', 'phonepe', 'paytm', 'cash', 'bank', 'cheque', 'other'] as const;
export type PaymentMode = (typeof paymentModes)[number];
export const paymentModeSchema = z.enum(paymentModes);

export function referenceRequired(mode: PaymentMode | string): boolean {
  return !['cash', 'cheque', 'other'].includes(mode);
}

/** Password rules for the first-login change and voluntary changes */
export function passwordProblems(pw: string, username: string, current?: string): string[] {
  const out: string[] = [];
  if (pw.length < 8) out.push('At least 8 characters');
  if (pw.length > 72) out.push('At most 72 characters');
  if (username && pw.toLowerCase() === username.toLowerCase()) out.push('Must not be your username');
  if (current && pw === current) out.push('Must be different from the current / temporary password');
  if (/^\s|\s$/.test(pw)) out.push('Must not start or end with a space');
  return out;
}

export const unitCodeSchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => UNIT_CODE_RE.test(s), 'Letters, digits and dashes only (max 20)');

export const usernameSchema = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => USERNAME_RE.test(s), 'Use letters, digits and dashes (2–40 characters)');

export const registrationSchema = z.object({
  fullName: personNameSchema,
  mobile: mobileSchema,
  unitTypeId: z.string().uuid('Choose your flat type'),
  unitId: z.string().uuid('Choose your flat'),
  password: z.string().min(8, 'At least 8 characters').max(72),
});
