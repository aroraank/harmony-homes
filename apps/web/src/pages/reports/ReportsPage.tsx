import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarRange, FileSpreadsheet, Home, UserRound } from 'lucide-react';
import { currentPeriod, formatINR, formatINRCompact } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { rpc } from '@/lib/supabase';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { ListRow } from '@/components/ListRow';
import { Card } from '@/components/ui/card';

type Trend = { period: string; label: string; collected_paise: number; spent_paise: number; closing_paise: number };

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-[12.5px] shadow-lg">
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="tabular flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full" style={{ background: p.color }} />
          {p.name}: <strong>{formatINR(p.value * 100)}</strong>
        </p>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const q = useQuery({ queryKey: ['trend', m.societyId], queryFn: () => rpc<Trend[]>('trend_months', { p_society: m.societyId, p_months: 12 }) });
  const data = (q.data ?? []).map((d) => ({
    label: d.label.replace(/ (\d{2})(\d{2})$/, " '$2"),
    [t('Collected')]: d.collected_paise / 100,
    [t('Spent')]: d.spent_paise / 100,
    [t('Balance')]: d.closing_paise / 100,
  }));
  const axis = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' };

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Reports')} subtitle={t('Open to every member — transparency builds trust')} back="/more" />
      <div className="space-y-2.5">
        <ListRow to={`/reports/month/${currentPeriod()}`} icon={<CalendarRange />} title={t('Month view')} subtitle={t('Opening, collected, spent, shortfall and closing')} />
        <ListRow to="/reports/defaulters" icon={<AlertTriangle />} title={t('Pending list')} subtitle={t('Flats with overdue dues, share on WhatsApp')} />
        <ListRow to={m.unit_id ? `/reports/unit/${m.unit_id}` : '/reports/unit'} icon={<Home />} title={t('Flat statement')} subtitle={t('Every due and payment of a flat')} />
        <ListRow to="/reports/payees" icon={<UserRound />} title={t('Payee history')} subtitle={t('e.g. all payments to the security guard')} />
        <ListRow to="/ledger" icon={<FileSpreadsheet />} title={t('Full ledger')} subtitle={t('Search and export every entry')} />
      </div>

      <SectionTitle>{t('Last 12 months')}</SectionTitle>
      {q.isLoading ? (
        <CardSkeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <Card className="p-3 pt-4">
            <p className="mb-2 px-1 text-sm font-bold">{t('Collected vs spent')}</p>
            <div className="h-64" role="img" aria-label={t('Bar chart of money collected and spent each month')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ left: -12, right: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINRCompact(v * 100)} width={56} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey={t('Collected')} fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={22} />
                  <Bar dataKey={t('Spent')} fill="#f43f5e" radius={[6, 6, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="mt-3 p-3 pt-4">
            <p className="mb-2 px-1 text-sm font-bold">{t('Balance at month end')}</p>
            <div className="h-52" role="img" aria-label={t('Line chart of the society balance at the end of each month')}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ left: -12, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatINRCompact(v * 100)} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey={t('Balance')} stroke="#059669" strokeWidth={3} dot={{ r: 3, fill: '#059669' }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}
      <p className="mt-3 text-center text-[12px] text-muted-foreground">
        <Link to="/ledger" className="font-semibold text-primary">
          {t('Every number comes from the ledger')}
        </Link>
      </p>
    </div>
  );
}
