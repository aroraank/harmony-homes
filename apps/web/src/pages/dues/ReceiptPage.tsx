import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Share2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { amountInWords, formatDate, formatDateTime, formatINR, periodLabel } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { MODE_LABELS, cn } from '@/lib/utils';
import { receiptPdf, shareOrDownloadPdf, type ReceiptData } from '@/lib/pdf';
import { downloadBlob } from '@/lib/csv';
import { brand } from '@/brand';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { Button } from '@/components/ui/button';
import type { LedgerRow } from '@/types';

type Alloc = { amount_paise: number; dues: { period: string | null; due_type: string; events: { title: string } | null } | null };

export default function ReceiptPage() {
  const { t } = useTranslation();
  const { entryId } = useParams();
  const m = useMember();
  const [busy, setBusy] = useState<'pdf' | 'share' | null>(null);

  const q = useQuery({
    queryKey: ['receipt', entryId],
    enabled: !!entryId,
    queryFn: async () => {
      const entry = unwrap<LedgerRow>(await supabase.from('v_ledger').select('*').eq('id', entryId!).single());
      const allocs = unwrap<Alloc[]>(
        await supabase.from('due_allocations').select('amount_paise, dues(period, due_type, events(title))').eq('ledger_entry_id', entryId!),
      );
      let memberName: string | null = null;
      if (entry.unit_id) {
        const mem = await supabase
          .from('memberships')
          .select('profiles!memberships_user_id_fkey(full_name)')
          .eq('unit_id', entry.unit_id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();
        memberName = (mem.data as unknown as { profiles: { full_name: string } | null } | null)?.profiles?.full_name ?? null;
      }
      return { entry, allocs, memberName };
    },
  });

  if (q.isLoading) return <CardSkeleton className="h-[480px]" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { entry: e, allocs, memberName } = q.data;
  if (!e.receipt_no) return <ErrorState error={new Error(t('No receipt for this entry.'))} />;

  const covers = allocs.map((a) => ({
    label: a.dues?.due_type === 'monthly' && a.dues.period ? periodLabel(a.dues.period) : (a.dues?.events?.title ?? t('Dues')),
    amount_paise: a.amount_paise,
  }));
  const allocated = covers.reduce((s, c) => s + c.amount_paise, 0);
  if (allocated < e.amount_paise && !e.is_reversed) covers.push({ label: t('Advance'), amount_paise: e.amount_paise - allocated });

  const data: ReceiptData = {
    societyName: m.society_name,
    receiptNo: e.receipt_no,
    date: e.entry_date,
    unitCode: e.unit_code ?? '',
    memberName,
    amountPaise: e.amount_paise,
    covers,
    mode: MODE_LABELS[e.payment_mode ?? ''] ?? e.payment_mode ?? '',
    reference: e.reference_no,
    recordedBy: e.created_by_name,
    postedAt: e.created_at,
    verifyUrl: `${window.location.origin}/r/${e.receipt_token}`,
    token: e.receipt_token ?? '',
    cancelled: e.is_reversed,
    cancelReason: e.reversal_note?.replace(/^Reversal:\s*/, '') ?? null,
  };
  const filename = `receipt-${e.receipt_no.replace(/\//g, '-')}.pdf`;

  const run = async (kind: 'pdf' | 'share') => {
    setBusy(kind);
    try {
      const blob = await receiptPdf(data);
      if (kind === 'pdf') downloadBlob(filename, blob);
      else await shareOrDownloadPdf(blob, filename, `${brand.name} receipt ${e.receipt_no} — ${formatINR(e.amount_paise)} for ${e.unit_code}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Receipt')} back />
      <div className="relative overflow-hidden rounded-3xl border bg-card shadow-card">
        <div className="hero-gradient flex items-center gap-3 p-4 text-white">
          <img src={brand.logo} alt="" className="size-10 rounded-xl ring-1 ring-white/30" />
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">{brand.name}</p>
            <p className="truncate text-[12.5px] text-white/85">{m.society_name}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{t('Receipt')}</p>
            <p className="tabular text-[13px] font-bold">{e.receipt_no}</p>
          </div>
        </div>
        <div className={cn('p-5', e.is_reversed && 'opacity-70')}>
          <p className="text-[12.5px] text-muted-foreground">{t('Amount received')}</p>
          <p className="tabular text-4xl font-extrabold tracking-tight text-credit">{formatINR(e.amount_paise)}</p>
          <p className="mt-1 text-[12.5px] italic text-muted-foreground">{amountInWords(e.amount_paise)}</p>
          <dl className="mt-4 divide-y rounded-2xl border text-sm">
            {[
              [t('Date'), formatDate(e.entry_date)],
              [t('Flat'), e.unit_code],
              [t('Received from'), memberName],
              [t('Towards'), covers.map((c) => `${c.label} ${formatINR(c.amount_paise)}`).join(', ')],
              [t('Mode'), data.mode],
              [t('UTR / reference'), e.reference_no],
              [t('Recorded / approved by'), e.created_by_name],
              [t('Posted at'), formatDateTime(e.created_at)],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-semibold">{v}</dd>
                </div>
              ))}
          </dl>
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" /> {t('Verify code')}: <span className="tabular font-bold text-foreground">{e.receipt_token}</span>
          </p>
        </div>
        {e.is_reversed && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="-rotate-[20deg] rounded-xl border-4 border-destructive px-5 py-2 text-center text-3xl font-black tracking-widest text-destructive">
              {t('CANCELLED')}
              {data.cancelReason && <p className="mt-1 max-w-[16rem] text-xs font-semibold tracking-normal">{data.cancelReason}</p>}
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" onClick={() => run('pdf')} loading={busy === 'pdf'}>
          <Download /> PDF
        </Button>
        <Button size="lg" onClick={() => run('share')} loading={busy === 'share'}>
          <Share2 /> {t('Share')}
        </Button>
      </div>
    </div>
  );
}
