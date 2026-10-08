import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { formatDate, formatDateTime, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { MODE_LABELS } from '@/lib/utils';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Found = {
  entry_id: string; receipt_no: string; date: string; amount_paise: number; unit_code: string | null; unit_name: string | null;
  fund: string | null; mode: string | null; reference_no: string | null; note: string | null; cancelled: boolean;
  recorded_by: string | null; recorded_at: string; covers: string[];
};

/** Look a receipt up by its number (e.g. HH/2026-27/0010). Admins find any receipt; a member only their own flat's. */
export function ReceiptLookup({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const m = useMember();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Found[] | null>(null);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErr(null);
    setRows(null);
    if (!value.trim()) return setErr(t('Type a receipt number, e.g. HH/2026-27/0010.'));
    setBusy(true);
    try {
      setRows(await rpc<Found[]>('find_receipt', { p_society: m.societyId, p_receipt: value }));
    } catch (x) {
      setErr(errorMessage(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setRows(null); setErr(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Verify a receipt')}</DialogTitle>
          <DialogDescription>
            {m.isAdmin ? t('Enter the receipt number the member shows you to confirm it is real and see which flat paid.') : t('Enter a receipt number to check your own payment.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={run} className="space-y-3">
          <Field label={t('Receipt number')}>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="HH/2026-27/0010" autoCapitalize="characters" autoComplete="off" maxLength={40} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            <ShieldCheck /> {t('Check')}
          </Button>
        </form>
        {err && <Alert variant="danger">{err}</Alert>}
        {rows && rows.length === 0 && (
          <Alert variant="danger">
            <span className="flex items-center gap-2">
              <ShieldX className="size-4" /> {t('No receipt found with this number.')}
            </span>
          </Alert>
        )}
        <div className="space-y-2">
          {rows?.map((r) => (
            <div key={r.entry_id} className="rounded-2xl border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="tabular font-bold">{r.receipt_no}</p>
                  <p className="text-[12.5px] text-muted-foreground">{formatDate(r.date)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${r.cancelled ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>
                  {r.cancelled ? t('Cancelled') : t('Valid')}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">{t('Flat')}</dt>
                <dd className="font-bold">{r.unit_code ?? '—'}{r.unit_name ? ` · ${r.unit_name}` : ''}</dd>
                <dt className="text-muted-foreground">{t('Amount')}</dt>
                <dd className="tabular font-bold">{formatINR(r.amount_paise)}</dd>
                <dt className="text-muted-foreground">{t('Paid by')}</dt>
                <dd>{(MODE_LABELS[r.mode ?? ''] ?? r.mode ?? '—') + (r.reference_no ? ` · ${r.reference_no}` : '')}</dd>
                {r.fund && (
                  <>
                    <dt className="text-muted-foreground">{t('Fund')}</dt>
                    <dd>{r.fund}</dd>
                  </>
                )}
                {r.covers.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">{t('For')}</dt>
                    <dd>{r.covers.join(', ')}</dd>
                  </>
                )}
                {r.recorded_by && (
                  <>
                    <dt className="text-muted-foreground">{t('Recorded by')}</dt>
                    <dd>{r.recorded_by} · {formatDateTime(r.recorded_at)}</dd>
                  </>
                )}
              </dl>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link to={`/receipts/${r.entry_id}`} onClick={() => onOpenChange(false)}>
                  {t('Open receipt')}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
