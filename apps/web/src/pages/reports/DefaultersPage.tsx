import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download, PartyPopper, Share2 } from 'lucide-react';
import { formatDate, formatINR, istToday } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { downloadCsv, rupees } from '@/lib/csv';
import { shareText, unitLabel } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Defaulter } from '@/types';

export default function DefaultersPage() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useQuery({
    queryKey: ['defaulters', m.societyId],
    queryFn: () => rpc<Defaulter[]>('defaulters', { p_society: m.societyId }),
  });
  const [open, setOpen] = useState<string | null>(null);
  const total = (q.data ?? []).reduce((s, d) => s + d.pending_paise, 0);

  const share = () =>
    shareText(
      `${m.society_name}\nPending dues as on ${formatDate(istToday())}\n\n${(q.data ?? [])
        .map(
          (d) =>
            `• ${d.unit_code}: ${formatINR(d.pending_paise)}${d.periods?.length ? ` (${d.periods.join(', ')})` : ''}`,
        )
        .join('\n')}\n\nTotal: ${formatINR(total)}\nPlease pay via the Harmony Homes app. Thank you!`,
    );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Pending list')}
        subtitle={
          m.isAdmin ? t('Flats with overdue dues, highest first') : t("Your flat's overdue dues, if any")
        }
        back="/reports"
      />
      <QueryState
        query={q}
        empty={(d) =>
          d.length ? null : (
            <EmptyState
              icon={<PartyPopper className="size-7" />}
              title={m.isAdmin ? t('No overdue dues') : t("You're all paid up")}
              hint={
                m.isAdmin
                  ? t('Every flat is up to date.')
                  : t('Nothing pending on your flat right now — this list will show any due you miss.')
              }
            />
          )
        }
      >
        {(list) => (
          <>
            <Card className="mb-3 flex items-center justify-between p-4">
              <div>
                <p className="text-[12.5px] font-semibold text-muted-foreground">
                  {t('{{n}} flats owe', { n: list.length })}
                </p>
                <p className="tabular text-2xl font-extrabold text-debit">{formatINR(total)}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="CSV"
                  onClick={() =>
                    downloadCsv(
                      `pending-${istToday()}.csv`,
                      ['Flat', 'Pending (Rs)', 'Months overdue', 'Events overdue', 'Oldest due', 'Periods'],
                      list.map((d) => [
                        d.unit_code,
                        rupees(d.pending_paise),
                        d.months_overdue,
                        d.events_overdue,
                        d.oldest_due_date,
                        (d.periods ?? []).join('; '),
                      ]),
                    )
                  }
                >
                  <Download />
                </Button>
                <Button onClick={share}>
                  <Share2 /> WhatsApp
                </Button>
              </div>
            </Card>
            <div className="space-y-2">
              {list.map((d) => (
                <div key={d.unit_id} className="rounded-2xl border bg-card shadow-card">
                  <button
                    type="button"
                    aria-expanded={open === d.unit_id}
                    onClick={() => setOpen(open === d.unit_id ? null : d.unit_id)}
                    className="flex w-full items-center gap-3 p-3.5 text-left"
                  >
                    <span className="tabular grid h-11 min-w-[64px] shrink-0 place-items-center rounded-xl bg-rose-50 px-2 text-center text-[12.5px] font-extrabold leading-tight text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                      {d.unit_code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13.5px] font-bold">
                        {unitLabel(d.unit_code, d.unit_name)}
                      </p>
                      <p className="break-words text-[13px] font-semibold text-muted-foreground">
                        {(d.periods ?? []).length <= 2
                          ? (d.periods ?? []).join(', ')
                          : t('{{first}} and {{n}} more', {
                              first: (d.periods ?? [])[0],
                              n: (d.periods ?? []).length - 1,
                            })}
                      </p>
                      <p className="text-[12px] text-muted-foreground">
                        {d.months_overdue > 0 && t('{{n}} month(s) overdue', { n: d.months_overdue })}
                        {d.months_overdue > 0 && d.events_overdue > 0 && ' · '}
                        {d.events_overdue > 0 && t('{{n}} event(s)', { n: d.events_overdue })}
                        {' · '}
                        {t('since {{d}}', { d: formatDate(d.oldest_due_date) })}
                      </p>
                    </div>
                    <Money paise={d.pending_paise} className="font-extrabold text-debit" />
                    <ChevronDown
                      className={`size-4 text-muted-foreground transition-transform ${open === d.unit_id ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {open === d.unit_id && (
                    <div className="border-t px-3.5 py-3">
                      <ul className="space-y-2 text-[13px]">
                        {(
                          d.items ??
                          (d.periods ?? []).map((l) => ({
                            label: l,
                            pending_paise: null as number | null,
                            due_date: '',
                          }))
                        ).map((it) => (
                          <li key={it.label} className="flex items-center gap-2">
                            <span className="size-1.5 shrink-0 rounded-full bg-rose-500" />
                            <span className="min-w-0 flex-1">{it.label}</span>
                            {it.pending_paise !== null && (
                              <Money paise={it.pending_paise} className="font-bold text-debit" />
                            )}
                          </li>
                        ))}
                      </ul>
                      <Link
                        to={`/reports/unit/${d.unit_id}`}
                        className="mt-3 inline-block text-[13px] font-bold text-primary"
                      >
                        {t('Full statement')} →
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}
