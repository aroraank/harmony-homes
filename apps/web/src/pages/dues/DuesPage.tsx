import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BadgeCheck,
  Clock3,
  FileText,
  Flame,
  Footprints,
  ReceiptText,
  Trophy,
  Wallet,
  XCircle,
} from 'lucide-react';
import { formatDate, formatINR } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { unwrap, useUnitDues } from '@/lib/queries';
import { cn, MODE_LABELS } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { StatusChip } from '@/components/StatusChip';
import { Money } from '@/components/Money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Claim, LedgerRow, UnitStatus } from '@/types';

export default function DuesPage() {
  const { t } = useTranslation();
  const m = useMember();
  if (!m.unit_id)
    return (
      <>
        <PageHeader title={t('Dues')} />
        <EmptyState
          icon={<Wallet className="size-7" />}
          title={t('This login is not linked to a flat')}
          hint={t('Use Reports to see any flat’s statement or the pending list.')}
          action={
            <Button asChild>
              <Link to="/reports/pending">{t('Open pending list')}</Link>
            </Button>
          }
        />
      </>
    );
  return <MyDues unitId={m.unit_id} unitCode={m.unit_code ?? ''} />;
}

function MyDues({ unitId, unitCode }: { unitId: string; unitCode: string }) {
  const { t } = useTranslation();
  const m = useMember();
  const dues = useUnitDues(unitId);
  const claims = useQuery({
    queryKey: ['claims', 'mine', unitId],
    queryFn: async () =>
      unwrap<Claim[]>(
        await supabase
          .from('payment_claims')
          .select('*')
          .eq('unit_id', unitId)
          .order('created_at', { ascending: false })
          .limit(50),
      ),
  });
  const receipts = useQuery({
    queryKey: ['ledger', 'receipts', unitId],
    queryFn: async () =>
      unwrap<LedgerRow[]>(
        await supabase
          .from('v_ledger')
          .select('*')
          .eq('unit_id', unitId)
          .eq('direction', 'credit')
          .is('reverses_entry_id', null)
          // only valid receipts: a cancelled / corrected receipt stays in the ledger for audit, not in this list
          .eq('is_reversed', false)
          .not('receipt_no', 'is', null)
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(100),
      ),
  });

  const pending = (dues.data ?? []).reduce((s, d) => s + d.pending_paise, 0);
  const pendingCount = (dues.data ?? []).filter((d) => !d.waived && d.pending_paise > 0).length;
  const pendingClaims = (claims.data ?? []).filter((c) => c.status === 'pending').length;

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('My dues')} subtitle={`${unitCode} · ${m.unit_name ?? ''}`} />
      <Card className="mb-4 flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[12.5px] font-semibold text-muted-foreground">{t('Total pending')}</p>
          <p
            className={
              pending > 0
                ? 'tabular text-3xl font-extrabold text-debit'
                : 'tabular text-3xl font-extrabold text-credit'
            }
          >
            {formatINR(pending)}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button asChild variant={pending > 0 ? 'hero' : 'secondary'}>
            <Link to="/pay">
              <Wallet /> {t('Pay')}
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to={`/reports/unit/${unitId}`}>
              <FileText /> {t('Statement')}
            </Link>
          </Button>
        </div>
      </Card>

      {dues.data && <DuesProgress pendingCount={pendingCount} />}

      <Tabs defaultValue="dues">
        <TabsList>
          <TabsTrigger value="dues">{t('Dues')}</TabsTrigger>
          <TabsTrigger value="claims">
            {t('My claims')}
            {pendingClaims > 0 && <Badge variant="warning">{pendingClaims}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="receipts">{t('Receipts')}</TabsTrigger>
        </TabsList>

        <TabsContent value="dues">
          <QueryState
            query={dues}
            empty={(d) =>
              d.length ? null : (
                <EmptyState title={t('No dues yet')} hint={t('Dues appear here when the month starts.')} />
              )
            }
          >
            {(d) => (
              <div className="space-y-2">
                {d.map((x) => {
                  const st: UnitStatus = x.waived
                    ? 'waived'
                    : x.pending_paise === 0
                      ? 'paid'
                      : x.paid_paise > 0
                        ? 'partial'
                        : 'pending';
                  return (
                    <Card key={x.id} className="flex items-center gap-3 p-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="break-words font-semibold">{x.label}</p>
                        <p className="text-[12.5px] text-muted-foreground">
                          {x.due_type === 'event' ? t('Special collection') : t('Maintenance')} · {t('due')}{' '}
                          {formatDate(x.due_date)}
                        </p>
                        {x.waived && x.waived_reason && (
                          <p className="text-[12px] text-muted-foreground">
                            {t('Waived')}: {x.waived_reason}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <Money paise={x.amount_paise} className="font-bold" />
                        <div className="mt-1">
                          <StatusChip status={st} />
                        </div>
                        {st === 'partial' && (
                          <p className="tabular mt-1 text-[11.5px] text-debit">
                            {formatINR(x.pending_paise)} {t('left')}
                          </p>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </QueryState>
        </TabsContent>

        <TabsContent value="claims">
          <QueryState
            query={claims}
            empty={(c) =>
              c.length ? null : (
                <EmptyState
                  icon={<BadgeCheck className="size-7" />}
                  title={t('No payment claims')}
                  hint={t('After paying by UPI, tell us with the UTR from the Pay screen.')}
                />
              )
            }
          >
            {(c) => (
              <div className="space-y-2">
                {c.map((x) => (
                  <Card key={x.id} className="p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Money paise={x.amount_paise} className="text-lg font-bold" />
                        <p className="text-[12.5px] text-muted-foreground">
                          {formatDate(x.paid_on)} · {MODE_LABELS[x.payment_mode] ?? x.payment_mode}
                          {x.reference_no ? ` · ${x.reference_no}` : ''}
                        </p>
                      </div>
                      {x.status === 'pending' && (
                        <Badge variant="warning">
                          <Clock3 className="size-3.5" /> {t('Pending verification')}
                        </Badge>
                      )}
                      {x.status === 'approved' && (
                        <Badge variant="success">
                          <BadgeCheck className="size-3.5" /> {t('Verified')}
                        </Badge>
                      )}
                      {x.status === 'rejected' && (
                        <Badge variant="danger">
                          <XCircle className="size-3.5" /> {t('Not approved')}
                        </Badge>
                      )}
                    </div>
                    {x.status === 'rejected' && x.reject_reason && (
                      <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-900 dark:bg-rose-500/10 dark:text-rose-200">
                        {t('Reason')}: {x.reject_reason}
                      </p>
                    )}
                    {x.status === 'approved' && x.ledger_entry_id && (
                      <Button asChild variant="link" size="sm" className="mt-1 h-auto px-0">
                        <Link to={`/receipts/${x.ledger_entry_id}`}>{t('View receipt')}</Link>
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </QueryState>
        </TabsContent>

        <TabsContent value="receipts">
          <QueryState
            query={receipts}
            empty={(r) =>
              r.length ? null : (
                <EmptyState
                  icon={<ReceiptText className="size-7" />}
                  title={t('No receipts yet')}
                  hint={t('Receipts appear only after the admin confirms a payment.')}
                />
              )
            }
          >
            {(r) => (
              <div className="space-y-2">
                {r.map((x) => (
                  <Link
                    key={x.id}
                    to={`/receipts/${x.id}`}
                    className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-card hover:bg-secondary/50"
                  >
                    <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                      <ReceiptText className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          x.is_reversed ? 'struck break-words font-semibold' : 'break-words font-semibold'
                        }
                      >
                        {x.receipt_no}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        {formatDate(x.entry_date)} · {x.fund_name}
                      </p>
                    </div>
                    <div className="text-right">
                      <Money
                        paise={x.amount_paise}
                        className={x.is_reversed ? 'struck font-bold' : 'font-bold'}
                      />
                      {x.is_reversed && (
                        <p className="text-[11px] font-bold text-destructive">{t('CANCELLED')}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </QueryState>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Small gamified nudge: a trophy once every due is cleared, or a "N more to go" counter while
 * payments remain — closer to zero gets a warmer, more urgent nudge to encourage finishing up.
 * Icons only (Trophy / Flame / Footprints) — no numeric progress bar, kept deliberately simple.
 */
function DuesProgress({ pendingCount }: { pendingCount: number }) {
  const { t } = useTranslation();

  if (pendingCount === 0)
    return (
      <Card className="relative mb-4 overflow-hidden border-amber-300 bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 p-4 text-center dark:border-amber-500/30 dark:from-amber-500/10 dark:via-yellow-500/10 dark:to-orange-500/10">
        <div className="pointer-events-none absolute -left-6 -top-6 size-24 rounded-full bg-amber-300/40 blur-2xl dark:bg-amber-400/20" />
        <span className="relative mx-auto grid size-14 place-items-center rounded-full bg-gradient-to-br from-amber-400 via-yellow-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
          <Trophy className="size-7" />
        </span>
        <p className="relative mt-2 font-extrabold text-amber-900 dark:text-amber-200">
          {t('All dues clear! 🎉')}
        </p>
      </Card>
    );

  const close = pendingCount <= 2;

  return (
    <Card
      className={cn(
        'mb-4 flex items-center gap-3 p-4',
        close
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : 'border-primary/20 bg-secondary/40',
      )}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-card">
        {close ? (
          <Flame className="size-6 text-orange-500" />
        ) : (
          <Footprints className="size-6 text-primary" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">
          {close
            ? t('So close! Just {{n}} more to go', { n: pendingCount })
            : t('{{n}} more payments to go', { n: pendingCount })}
        </p>
        <p className="text-[12.5px] text-muted-foreground">{t('Clear them to reach the trophy')}</p>
      </div>
      <Trophy className={cn('size-6 shrink-0', close ? 'text-amber-500' : 'text-muted-foreground/30')} />
    </Card>
  );
}
