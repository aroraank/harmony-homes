import { Mail, MessageCircle, Phone } from 'lucide-react';
import { brand } from '@/brand';
import { cn } from '@/lib/utils';

/** "Powered by …" credit with email + WhatsApp links. */
export function CreditLine({ className, light }: { className?: string; light?: boolean }) {
  const { name, email, whatsapp } = brand.credit;
  const phone = `+${whatsapp.slice(0, 2)} ${whatsapp.slice(2, 7)} ${whatsapp.slice(7)}`;
  const link = cn('inline-flex min-h-8 items-center gap-1 rounded-full px-1.5 font-semibold underline-offset-2 hover:underline', light ? 'text-white' : 'text-primary');
  return (
    <p className={cn('flex flex-wrap items-center justify-center gap-x-1 text-[11.5px]', light ? 'text-white/80' : 'text-muted-foreground', className)}>
      <span>Powered by</span>
      <a href={`mailto:${email}`} className={link}>
        {name}
      </a>
      <span aria-hidden>·</span>
      <a href={`tel:+${whatsapp}`} className={link} aria-label={`Call ${name}`}>
        <Phone className="size-3.5" /> {phone}
      </a>
      <span aria-hidden>·</span>
      <a href={`mailto:${email}`} className={link} aria-label={`Email ${name}`}>
        <Mail className="size-3.5" /> Email
      </a>
      <span aria-hidden>·</span>
      <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className={link} aria-label={`WhatsApp ${name}`}>
        <MessageCircle className="size-3.5" /> WhatsApp
      </a>
    </p>
  );
}
