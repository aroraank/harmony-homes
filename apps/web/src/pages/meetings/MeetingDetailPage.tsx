import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarClock, MapPin, Pencil, Trash2, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { nudgePush } from '@/lib/push';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { ConfirmSheet } from '@/components/ConfirmSheet';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/Field';
import { MeetingAgenda } from '@/components/MeetingAgenda';
import type { Meeting } from '@/types';

function timeLabel(t: string) {
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export default function MeetingDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const m = useMember();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['meeting', id],
    queryFn: async () => unwrap<Meeting>(await supabase.from('v_meetings').select('*').eq('id', id!).single()),
  });
  const [action, setAction] = useState<null | 'delete' | 'cancel'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isLoading) return <CardSkeleton className="h-80" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const x = q.data;
  const canManage = m.can('manage_meetings');

  const run = async () => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await rpc('delete_meeting_draft', { p_meeting_id: x.id });
        toast.success(t('Draft deleted'));
        void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
        nav('/meetings', { replace: true });
        return;
      }
      if (action === 'cancel') {
        await rpc('cancel_meeting', { p_meeting_id: x.id, p_reason: reason || null });
        toast.success(t('Meeting cancelled'));
        nudgePush();
      }
      void qc.invalidateQueries({ queryKey: ['meeting', id] });
      void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
      void qc.invalidateQueries({ queryKey: ['nextMeeting', m.societyId] });
      setAction(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      await rpc('publish_meeting', { p_meeting_id: x.id });
      toast.success(t('Meeting published'));
      void qc.invalidateQueries({ queryKey: ['meeting', id] });
      void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
      void qc.invalidateQueries({ queryKey: ['nextMeeting', m.societyId] });
      nudgePush();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={x.title}
        subtitle={`${formatDate(x.meeting_date)} · ${timeLabel(x.start_time)}`}
        back="/meetings"
        actions={
          <Badge variant={x.status === 'draft' ? 'warning' : x.status === 'cancelled' ? 'muted' : 'success'}>
            {t(x.status === 'draft' ? 'Draft' : x.status === 'cancelled' ? 'Cancelled' : 'Published')}
          </Badge>
        }
      />
      {x.description && <p className="mb-3 text-sm text-muted-foreground">{x.description}</p>}

      <Card className="space-y-2 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-primary" /> {t('Expected to attend: {{a}}', { a: x.audience_label })}
        </p>
        {x.location && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4" /> {x.location}
          </p>
        )}
        {x.created_by_name && <p className="text-[12px] text-muted-foreground">{t('Called by {{n}}', { n: x.created_by_name })}</p>}
      </Card>

      {canManage && x.status !== 'cancelled' && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {x.status === 'draft' && (
            <Button onClick={publish} disabled={busy}>
              <CalendarClock /> {t('Publish')}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to={`/meetings/${x.id}/edit`}>
              <Pencil /> {t('Edit')}
            </Link>
          </Button>
          {x.status === 'draft' ? (
            <Button variant="outline" className="col-span-2" onClick={() => setAction('delete')}>
              <Trash2 /> {t('Delete draft')}
            </Button>
          ) : (
            <Button variant="outline" className="col-span-2" onClick={() => setAction('cancel')}>
              <XCircle /> {t('Cancel meeting')}
            </Button>
          )}
        </div>
      )}

      <SectionTitle>{t('Agenda')}</SectionTitle>
      <MeetingAgenda meeting={x} />

      <ConfirmSheet
        open={action === 'delete'}
        onOpenChange={(o) => !o && setAction(null)}
        title={t('Delete this draft?')}
        description={t('Nothing was sent to members yet. This cannot be undone.')}
        confirmLabel={t('Delete draft')}
        destructive
        loading={busy}
        onConfirm={run}
      />
      <ConfirmSheet
        open={action === 'cancel'}
        onOpenChange={(o) => !o && setAction(null)}
        title={t('Cancel this meeting?')}
        description={t('Everyone who was notified about it will be told it is cancelled.')}
        confirmLabel={t('Cancel meeting')}
        destructive
        loading={busy}
        onConfirm={run}
      >
        <Field label={t('Reason')} optional className="mt-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
      </ConfirmSheet>
    </div>
  );
}
