import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import { formatDate, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { categoryLabel, cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';

type History = {
  entries: {
    entry_id: string;
    date: string;
    amount_paise: number;
    category: string;
    mode: string;
    note: string | null;
    is_reversed: boolean;
  }[];
  months: { period: string; label: string; amount_paise: number }[];
};

export default function PayeeHistoryPage() {
  const { t } = useTranslation();
  const m = useMember();
  const payees = useQuery({
    queryKey: ['payees', m.societyId],
    queryFn: () =>
      rpc<{ payee: string; count: number; total_paise: number }[]>('payee_list', { p_society: m.societyId }),
    enabled: m.isAdmin,
  });
  const [payee, setPayee] = useState('');
  const hist = useQuery({
    queryKey: ['payeeHistory', m.societyId, payee],
    enabled: m.isAdmin && !!payee,
    queryFn: () => rpc<History>('payee_history', { p_society: m.societyId, p_payee: payee }),
  });

  // Vendor payments (e.g. the security guard) are a society-level accounting report, not a
  // member's own history — only admins can see who was paid and how much.
  if (!m.isAdmin) return <Navigate to="/reports" replace />;

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Payee history')} back="/reports" />
      <NativeSelect value={payee} onChange={(e) => setPayee(e.target.value)} aria-label={t('Payee')}>
        <option value="">{t('Choose a payee…')}</option>
        {payees.data?.map((p) => (
          <option key={p.payee} value={p.payee}>
            {p.payee} ({p.count})
          </option>
        ))}
      </NativeSelect>
      {!payee ? (
        <EmptyState
          icon={<UserRound className="size-7" />}
          title={t('Pick someone the society pays')}
          hint={t('For example the security guard — see every payment and monthly totals.')}
        />
      ) : (
        <QueryState
          query={hist}
          empty={(h) => (h.entries.length ? null : <EmptyState title={t('No payments')} />)}
        >
          {(h) => (
            <>
              <SectionTitle>{t('Totals per month')}</SectionTitle>
              <Card className="divide-y">
                {h.months.map((x) => (
                  <div key={x.period} className="flex justify-between px-4 py-3 text-sm">
                    <span className="font-medium">{x.label}</span>
                    <Money paise={x.amount_paise} className="font-bold" />
                  </div>
                ))}
              </Card>
              <SectionTitle>{t('All payments')}</SectionTitle>
              <Card className="divide-y">
                {h.entries.map((e) => (
                  <div key={e.entry_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm font-semibold', e.is_reversed && 'struck')}>
                        {formatDate(e.date)}
                      </p>
                      <p className="break-words text-[12px] text-muted-foreground">
                        {categoryLabel(e.category)}
                        {e.note ? ` · ${e.note}` : ''}
                      </p>
                    </div>
                    <span className={cn('tabular font-bold', e.is_reversed && 'struck')}>
                      {formatINR(e.amount_paise)}
                    </span>
                  </div>
                ))}
              </Card>
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}
