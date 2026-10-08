import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Archive, BellRing, CheckCheck, Download, Eye, MapPin, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap, useUnits } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { deviceLabel } from '@/lib/utils';
import { downloadCsv } from '@/lib/csv';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { RichText } from '@/components/RichText';
import { AttachmentButton } from '@/components/AttachmentButton';
import { StatTile } from '@/components/StatTile';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Notice, NoticeReceipt } from '@/types';

type RecRow = NoticeReceipt & { profiles: { full_name: string } | null };

export default function NoticeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const m = useMember();
  const qc = useQueryClient();
  const units = useUnits(m.societyId);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'acked'>('all');

  const q = useQuery({
    queryKey: ['notice', id],
    enabled: !!id,
    queryFn: async () => {
      const notice = unwrap<Notice>(await supabase.from('notices').select('*').eq('id', id!).single());
      const recs = unwrap<RecRow[]>(await supabase.from('notice_receipts').select('*, profiles(full_name)').eq('notice_id', id!));
      return { notice, recs };
    },
  });

  useEffect(() => {
    if (id && q.data?.recs.some((r) => r.user_id === m.userId && !r.opened_at)) {
      void rpc('mark_notice_opened', { p_notice_id: id }).catch(() => undefined);
    }
  }, [id, q.data, m.userId]);

  const unitCode = useMemo(() => Object.fromEntries((units.data ?? []).map((u) => [u.id, u.code])), [units.data]);
  const unitOrder = useMemo(() => Object.fromEntries((units.data ?? []).map((u, i) => [u.id, i])), [units.data]);

  if (q.isLoading) return <CardSkeleton className="h-80" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { notice: n, recs } = q.data;
  const mine = recs.find((r) => r.user_id === m.userId);
  const isAdmin = m.can('send_notices');
  const delivered = recs.filter((r) => r.delivered_at).length;
  const opened = recs.filter((r) => r.opened_at).length;
  const acked = recs.filter((r) => r.acknowledged_at).length;
  const list = recs
    .filter((r) => (filter === 'all' ? true : filter === 'acked' ? !!r.acknowledged_at : !r.acknowledged_at))
    .sort((a, b) => (unitOrder[a.unit_id ?? ''] ?? 1e9) - (unitOrder[b.unit_id ?? ''] ?? 1e9));

  const remind = async () => {
    setBusy('remind');
    try {
      const n2 = await rpc<number>('remind_notice_pending', { p_notice_id: n.id });
      nudgePush();
      toast.success(t('Reminder sent to {{n}} member(s)', { n: n2 }));
      void q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const archive = async () => {
    setBusy('archive');
    try {
      await rpc('archive_notice', { p_notice_id: n.id });
      toast.success(t('Notice archived'));
      void qc.invalidateQueries({ queryKey: ['notices'] });
      void q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const exportCsv = () =>
    downloadCsv(
      `notice-receipts-${n.id.slice(0, 8)}.csv`,
      ['Flat', 'Member', 'Delivered', 'Opened', 'Acknowledged', 'IP', 'Device', 'Latitude', 'Longitude', 'Accuracy (m)'],
      list.map((r) => [
        unitCode[r.unit_id ?? ''] ?? '',
        r.profiles?.full_name,
        formatDateTime(r.delivered_at),
        formatDateTime(r.opened_at),
        formatDateTime(r.acknowledged_at),
        r.ack_ip,
        r.ack_user_agent ? deviceLabel(r.ack_user_agent) : '',
        r.ack_lat,
        r.ack_lng,
        r.ack_accuracy ? Math.round(r.ack_accuracy) : '',
      ]),
    );

  return (
    <div className="animate-fade-up">
      <PageHeader title={t('Notice')} back="/notices" />
      <Card className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {n.priority === 'important' && <Badge variant="danger">{t('Important')}</Badge>}
          {n.archived_at && <Badge variant="muted">{t('Archived')}</Badge>}
          <span className="text-[12px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
        </div>
        <h2 className="text-xl font-extrabold leading-tight tracking-tight">{n.title}</h2>
        <RichText text={n.body} className="mt-3 text-[15px]" />
        {n.attachment_path && (
          <div className="mt-4">
            <AttachmentButton path={n.attachment_path} />
          </div>
        )}
        {mine?.acknowledged_at && (
          <p className="mt-4 flex items-center gap-2 text-[13px] font-semibold text-credit">
            <CheckCheck className="size-4" /> {t('You acknowledged this on {{d}}', { d: formatDateTime(mine.acknowledged_at) })}
          </p>
        )}
      </Card>

      {isAdmin && (
        <>
          <SectionTitle>{t('Read receipts')}</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label={t('Delivered')} value={`${delivered}/${recs.length}`} icon={<Send />} />
            <StatTile label={t('Opened')} value={`${opened}/${recs.length}`} icon={<Eye />} />
            <StatTile label={t('Acknowledged')} value={`${acked}/${recs.length}`} icon={<CheckCheck />} tone={acked === recs.length ? 'good' : 'default'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!n.archived_at && acked < recs.length && (
              <Button onClick={remind} loading={busy === 'remind'}>
                <BellRing /> {t('Remind pending ({{n}})', { n: recs.length - acked })}
              </Button>
            )}
            <Button variant="outline" onClick={exportCsv}>
              <Download /> CSV
            </Button>
            {!n.archived_at && (
              <Button variant="ghost" onClick={archive} loading={busy === 'archive'}>
                <Archive /> {t('Archive')}
              </Button>
            )}
          </div>
          <div className="mt-3 flex gap-1.5">
            {(['all', 'pending', 'acked'] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                {f === 'all' ? t('All') : f === 'pending' ? t('Not acknowledged') : t('Acknowledged')}
              </Button>
            ))}
          </div>
          <Card className="mt-2 divide-y">
            {list.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    <span className="tabular">{unitCode[r.unit_id ?? ''] ?? t('Staff')}</span>
                    <span className="font-normal text-muted-foreground"> · {r.profiles?.full_name}</span>
                  </p>
                  {r.acknowledged_at ? <Badge variant="success">{t('Acknowledged')}</Badge> : r.opened_at ? <Badge variant="info">{t('Opened')}</Badge> : <Badge variant="muted">{t('Not opened')}</Badge>}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {r.acknowledged_at
                    ? `${t('Acknowledged')} ${formatDateTime(r.acknowledged_at)}`
                    : r.opened_at
                      ? `${t('Opened')} ${formatDateTime(r.opened_at)}`
                      : r.delivered_at
                        ? `${t('Delivered')} ${formatDateTime(r.delivered_at)}`
                        : t('Not delivered yet')}
                  {r.ack_user_agent ? ` · ${deviceLabel(r.ack_user_agent)}` : ''}
                  {r.ack_ip ? ` · IP ${r.ack_ip}` : ''}
                </p>
                {r.ack_lat != null && r.ack_lng != null && (
                  <a
                    className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                    href={`https://www.google.com/maps?q=${r.ack_lat},${r.ack_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MapPin className="size-3.5" /> {r.ack_lat.toFixed(4)}, {r.ack_lng.toFixed(4)}
                    {r.ack_accuracy ? ` (±${Math.round(r.ack_accuracy)} m)` : ''}
                  </a>
                )}
              </div>
            ))}
          </Card>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {t('Location is collected only at acknowledgement and only if the member allows it. The super admin can purge old locations in Settings.')}
          </p>
        </>
      )}
    </div>
  );
}
