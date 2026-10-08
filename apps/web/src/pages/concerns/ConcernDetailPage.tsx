import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EyeOff, Lock, MoreVertical, RotateCcw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { uploadFile } from '@/lib/files';
import { nudgePush } from '@/lib/push';
import { useOnline } from '@/lib/online';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { CardSkeleton, ErrorState } from '@/components/States';
import { RichText } from '@/components/RichText';
import { AttachmentButton } from '@/components/AttachmentButton';
import { FileInput } from '@/components/FileInput';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CATEGORY_TEXT, ConcernStatus } from './shared';
import type { Concern, ConcernMessage } from '@/types';

type AdminRow = { user_id: string; profiles: { full_name: string } | null };

export default function ConcernDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const m = useMember();
  const qc = useQueryClient();
  const online = useOnline();
  const bottom = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [statusNote, setStatusNote] = useState<{ status: Concern['status']; note: string } | null>(null);
  const [hide, setHide] = useState<{ id: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ['concern', id],
    enabled: !!id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const concern = unwrap<Concern>(await supabase.from('v_concerns').select('*').eq('id', id!).single());
      const messages = unwrap<ConcernMessage[]>(await supabase.from('v_concern_messages').select('*').eq('concern_id', id!).order('created_at'));
      return { concern, messages };
    },
  });
  const admins = useQuery({
    queryKey: ['admins', m.societyId],
    enabled: m.isAdmin,
    queryFn: async () =>
      unwrap<AdminRow[]>(
        await supabase.from('memberships').select('user_id, profiles!memberships_user_id_fkey(full_name)').eq('society_id', m.societyId).eq('status', 'active').in('role', ['admin', 'super_admin']),
      ),
  });

  useEffect(() => {
    if (!id || !q.data) return;
    void rpc('mark_concern_read', { p_concern_id: id }).then(() => qc.invalidateQueries({ queryKey: ['concerns'] }));
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [id, q.data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading) return <CardSkeleton className="h-96" />;
  if (!q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { concern: c, messages } = q.data;
  const canReopen = !m.isAdmin && c.status === 'resolved' && c.resolved_at && Date.now() - new Date(c.resolved_at).getTime() < 7 * 86400_000;

  const send = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const path = file ? await uploadFile(m.societyId, 'concerns', c.id, file) : null;
      await rpc('reply_concern', { p_concern_id: c.id, p_body: reply, p_attachment_path: path });
      setReply('');
      setFile(null);
      nudgePush();
      await q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: Concern['status'], note: string) => {
    setBusy(true);
    try {
      await rpc('set_concern_status', { p_concern_id: c.id, p_status: status, p_note: note || null });
      nudgePush();
      setStatusNote(null);
      await q.refetch();
      void qc.invalidateQueries({ queryKey: ['concerns'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (userId: string) => {
    try {
      await rpc('assign_concern', { p_concern_id: c.id, p_user_id: userId || null });
      nudgePush();
      await q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const hideMessage = async () => {
    if (!hide) return;
    setBusy(true);
    try {
      await rpc('hide_concern_message', { p_message_id: hide.id, p_reason: hide.reason });
      setHide(null);
      await q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title={c.title} subtitle={t(CATEGORY_TEXT[c.category] ?? c.category)} back="/concerns" />
      <Card className="mb-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ConcernStatus status={c.status} />
          {c.priority === 'urgent' && <Badge variant="danger">{t('Urgent')}</Badge>}
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <Lock className="size-3.5" /> {t('Private')}
          </span>
        </div>
        {m.isAdmin && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {t('Raised by')}: <strong className="text-foreground">{c.raiser_name ? `${c.raiser_name}${c.unit_code ? ` (${c.unit_code})` : ''}` : t('Member (name hidden)')}</strong> · {formatDateTime(c.created_at)}
          </p>
        )}
        {m.isAdmin ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <NativeSelect value={c.status} onChange={(e) => setStatusNote({ status: e.target.value as Concern['status'], note: '' })} aria-label={t('Status')} className="h-11 text-sm">
              <option value="open">{t('Open')}</option>
              <option value="in_progress">{t('In progress')}</option>
              <option value="resolved">{t('Resolved')}</option>
              <option value="closed">{t('Closed')}</option>
            </NativeSelect>
            <NativeSelect value={c.assigned_to ?? ''} onChange={(e) => void assign(e.target.value)} aria-label={t('Assigned to')} className="h-11 text-sm">
              <option value="">{t('Unassigned')}</option>
              {admins.data?.map((a) => (
                <option key={a.user_id} value={a.user_id}>
                  {a.profiles?.full_name ?? a.user_id.slice(0, 6)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          (canReopen || (c.status !== 'closed' && c.is_mine)) && (
            <div className="mt-3 flex gap-2">
              {canReopen && (
                <Button size="sm" variant="outline" onClick={() => setStatusNote({ status: 'open', note: '' })}>
                  <RotateCcw /> {t('Reopen')}
                </Button>
              )}
              {c.status !== 'closed' && c.is_mine && (
                <Button size="sm" variant="ghost" onClick={() => setStatusNote({ status: 'closed', note: '' })}>
                  {t('Close concern')}
                </Button>
              )}
            </div>
          )
        )}
      </Card>

      <div className="space-y-3">
        {messages.map((msg) =>
          msg.is_system ? (
            <p key={msg.id} className="mx-auto max-w-[85%] rounded-full bg-muted px-3 py-1.5 text-center text-[12px] text-muted-foreground">
              {msg.body} · {formatDateTime(msg.created_at)}
            </p>
          ) : (
            <div key={msg.id} className={cn('flex', msg.is_mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-3xl px-4 py-3 shadow-card',
                  msg.is_mine ? 'rounded-br-lg bg-primary text-primary-foreground' : 'rounded-bl-lg border bg-card',
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <p className={cn('text-[12px] font-bold', msg.is_mine ? 'text-primary-foreground/90' : 'text-foreground')}>
                    {msg.is_mine ? t('You') : msg.author_name}
                    {msg.author_role !== 'resident' && !msg.is_mine && <span className="ml-1 font-semibold text-primary">· {msg.author_role === 'super_admin' ? t('Super admin') : t('Admin')}</span>}
                  </p>
                  {m.isAdmin && !msg.hidden_at && !msg.is_mine && (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="ml-auto grid size-7 cursor-pointer place-items-center rounded-full hover:bg-muted" aria-label={t('Message options')}>
                        <MoreVertical className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem destructive onSelect={() => setHide({ id: msg.id, reason: '' })}>
                          <EyeOff /> {t('Hide abusive message')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {msg.hidden_at && !msg.body ? (
                  <p className="text-sm italic opacity-80">{t('This message was hidden by an admin.')}</p>
                ) : (
                  <>
                    {msg.hidden_at && <p className="mb-1 text-[11px] font-semibold uppercase opacity-80">{t('Hidden')}: {msg.hidden_reason}</p>}
                    <RichText text={msg.body ?? ''} className="text-[14.5px]" />
                  </>
                )}
                {msg.attachment_path && (
                  <div className="mt-2">
                    <AttachmentButton path={msg.attachment_path} />
                  </div>
                )}
                <p className={cn('mt-1 text-[11px]', msg.is_mine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{formatDateTime(msg.created_at)}</p>
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {c.status !== 'closed' ? (
        <Card className="sticky bottom-[84px] z-10 mt-4 space-y-2 p-3 shadow-lift">
          <Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('Write a reply…')} maxLength={4000} aria-label={t('Reply')} className="min-h-[72px]" />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <FileInput value={file} onChange={setFile} label={t('Attach')} />
            </div>
            <Button onClick={send} loading={sending} disabled={!reply.trim() || !online} size="lg">
              <Send /> {t('Send')}
            </Button>
          </div>
        </Card>
      ) : (
        <p className="mt-4 text-center text-sm text-muted-foreground">{t('This concern is closed.')}</p>
      )}

      <Dialog open={!!statusNote} onOpenChange={(o) => !o && setStatusNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Change status')}</DialogTitle>
          </DialogHeader>
          <Field label={t('Note')} optional>
            <Input value={statusNote?.note ?? ''} onChange={(e) => setStatusNote((s) => (s ? { ...s, note: e.target.value } : s))} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusNote(null)}>
              {t('Cancel')}
            </Button>
            <Button loading={busy} onClick={() => statusNote && changeStatus(statusNote.status, statusNote.note)}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!hide} onOpenChange={(o) => !o && setHide(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Hide message')}</DialogTitle>
          </DialogHeader>
          <Field label={t('Reason (kept in the audit log)')}>
            <Textarea rows={2} value={hide?.reason ?? ''} onChange={(e) => setHide((h) => (h ? { ...h, reason: e.target.value } : h))} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHide(null)}>
              {t('Cancel')}
            </Button>
            <Button variant="destructive" loading={busy} disabled={(hide?.reason.trim().length ?? 0) < 3} onClick={hideMessage}>
              {t('Hide')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
