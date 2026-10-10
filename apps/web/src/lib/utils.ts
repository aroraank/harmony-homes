import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '•';
}

export function deviceLabel(ua: string = navigator.userAgent): string {
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iPhone/iPad'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X/i.test(ua)
          ? 'Mac'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/i.test(ua)
      ? 'Samsung Internet'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  return `${browser} on ${os}`;
}

export function isIOS(): boolean {
  return (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** True only on an iPhone/iPad that is NOT running Safari (Chrome, Firefox, Edge, etc. on iOS
 * are all just Safari's WebKit under an Apple-imposed restriction, so none of them can install
 * a PWA or add it to the home screen — only Safari itself can). */
export function isIOSNonSafari(): boolean {
  const ua = navigator.userAgent;
  return isIOS() && /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
}

export const CATEGORY_LABELS: Record<string, string> = {
  maintenance: 'Maintenance',
  event_contribution: 'Event contribution',
  transfer: 'Transfer',
  opening_balance: 'Opening balance',
  adjustment: 'Adjustment',
  salary: 'Security salary',
  electricity: 'Electricity',
  water: 'Water',
  repair: 'Repair',
  cleaning: 'Cleaning',
  other: 'Other',
};

export const MODE_LABELS: Record<string, string> = {
  upi: 'UPI',
  gpay: 'GPay',
  phonepe: 'PhonePe',
  paytm: 'Paytm',
  cash: 'Cash',
  bank: 'Bank transfer',
  cheque: 'Cheque',
  other: 'Other',
};

export function categoryLabel(code: string, custom?: { code: string; label: string }[]): string {
  return custom?.find((c) => c.code === code)?.label ?? CATEGORY_LABELS[code] ?? code.replace(/_/g, ' ');
}

/** Share text via the native share sheet, falling back to WhatsApp */
export async function shareText(text: string, title = 'Harmony Homes'): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export function whatsappLink(phone: string, text?: string): string {
  return `https://wa.me/91${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const FLOOR_LONG_NAMES: Record<string, string> = {
  LG: 'Lower Ground',
  B: 'Basement',
  G: 'Ground Floor',
  GF: 'Ground Floor',
  FF: 'First Floor',
  SF: 'Second Floor',
  TF: 'Third Floor',
};

/**
 * Human-friendly flat label for members, e.g. "Plot 2, First Floor" instead of "P2-FF".
 * Prefers a real display name when one is available; otherwise expands the short code.
 */
export function unitLabel(code: string | null | undefined, displayName?: string | null): string {
  if (displayName) return displayName;
  if (!code) return '';
  const m = /^P?(\d+)[\s-]?([A-Za-z]{1,3})$/.exec(code.trim());
  if (m) {
    const floor = FLOOR_LONG_NAMES[m[2].toUpperCase()] ?? m[2];
    return `Plot ${m[1]}, ${floor}`;
  }
  return code;
}
