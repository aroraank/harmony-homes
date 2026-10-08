import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BadgeCheck, ShieldX, XCircle } from 'lucide-react';
import { formatDate, formatINR } from '@harmony/shared';
import { supabase } from '@/lib/supabase';
import { AuthLayout } from '../auth/AuthLayout';

type Result = { receipt_no: string; society: string; amount_paise: number; entry_date: string; unit_code: string | null; status: 'valid' | 'cancelled' } | null;

/** Public page opened from the QR code on a receipt. Shows only what is printed on the receipt itself. */
export default function VerifyReceiptPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['verify', token],
    enabled: !!token && /^[A-Fa-f0-9]{12}$/.test(token),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('verify_receipt', { p_token: token });
      if (error) throw error;
      return data as Result;
    },
  });
  const r = q.data;
  return (
    <AuthLayout title={t('Receipt check')} society={r?.society}>
      {q.isLoading ? (
        <p className="py-6 text-center text-muted-foreground">{t('Checking…')}</p>
      ) : !r ? (
        <div className="flex flex-col items-center py-4 text-center">
          <ShieldX className="size-14 text-destructive" />
          <p className="mt-3 text-lg font-bold">{t('Not a valid receipt')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('This code does not match any receipt issued by Harmony Homes.')}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center py-2 text-center">
          {r.status === 'valid' ? <BadgeCheck className="size-14 text-primary" /> : <XCircle className="size-14 text-destructive" />}
          <p className="mt-3 text-lg font-bold">{r.status === 'valid' ? t('Genuine receipt') : t('This receipt was cancelled')}</p>
          <dl className="mt-4 w-full divide-y rounded-2xl border text-left text-sm">
            {[
              [t('Receipt no.'), r.receipt_no],
              [t('Society'), r.society],
              [t('Flat'), r.unit_code ?? '—'],
              [t('Date'), formatDate(r.entry_date)],
              [t('Amount'), formatINR(r.amount_paise)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p className="mt-5 text-center text-sm">
        <Link to="/login" className="font-semibold text-primary">
          {t('Open Harmony Homes')}
        </Link>
      </p>
    </AuthLayout>
  );
}
