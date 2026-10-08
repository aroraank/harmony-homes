import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';

/** Digits-only sanitiser for PINs (6 to 12 digits). */
export function sanitizePin(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

/**
 * PIN field: opens the number keypad on phones and tablets, accepts digits only, with a show / hide eye.
 * `anyCharacters` is only for the "current / temporary" box, so an older letters-and-digits password can still be typed on a computer.
 */
export function PinInput({
  value,
  onChange,
  anyCharacters,
  autoComplete = 'new-password',
  defaultShown = false,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  anyCharacters?: boolean;
  autoComplete?: string;
  defaultShown?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const { t } = useTranslation();
  const [show, setShow] = React.useState(defaultShown);
  return (
    <div className="relative">
      <Input
        {...rest}
        type={show ? 'text' : 'password'}
        inputMode="numeric"
        pattern={anyCharacters ? undefined : '[0-9]*'}
        maxLength={anyCharacters ? 72 : 12}
        autoComplete={autoComplete}
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(anyCharacters ? e.target.value : sanitizePin(e.target.value))}
        className="tabular pr-12 tracking-[0.25em]"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
        aria-label={show ? t('Hide PIN') : t('Show PIN')}
      >
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}
