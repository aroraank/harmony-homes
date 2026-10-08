import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Clock, MessageSquarePlus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { istToday } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Meeting } from '@/types';

/**
 * Agenda of a meeting. Points written by admins (and accepted suggestions) come first; member suggestions that are still
 * waiting are shown faded below with the name of the member who asked. Anyone can suggest; admins accept or decline.
 */
export function MeetingAgenda({ meeting, limit }: { meeting: Meeting; limit?: number }) {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = m.can('manage_meetings');
  const canSuggest = meeting.status === 'published' && meeting.meeting_date >= istToday();
  const items = limit ? meeting.agenda.slice(0, limit) : meeting.agenda;
  const hidden = meeting.agenda.length - items.length;
  const approved = meeting.agenda.filter((a) => a.status === 'approved');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['meeting', meeting.id] });
    void qc.invalidateQueries({ queryKey: ['nextMeeting', m.societyId] });
    void qc.invalidateQueries({ queryKey: ['meetings', m.societyId] });
  };
  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try {
      await rpc(fn, args);
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const send = async () => {
    if (text.trim().length < 3) return toast.error(t('Write the agenda point in 3–300 characters.'));
    setBusy(true);
    try {
      await rpc('suggest_agenda_item', { p_meeting_id: meeting.id, p_text: text });
      toast.success(canManage ? t('Added for approval below') : t('Sent to the admins for approval'));
      setText('');
      setOpen(false);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No agenda items yet.')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((a) => {
            const pending = a.status === 'suggested';
            const n = approved.findIndex((x) => x.id === a.id) + 1;
            return (
              <li
                key={a.id}
                className={cn('flex items-start gap-2.5 rounded-xl px-3 py-2.5', pending ? 'border border-dashed bg-muted/30 opacity-60' : 'bg-secondary/50')}
              >
                <span className="tabular mt-0.5 w-5 shrink-0 text-[12px] font-bold text-muted-foreground">{pending ? '•' : `${n}.`}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.text}</p>
                  {a.by && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground">
                      {pending && <Clock className="size-3" />}
                      {pending ? t('Suggested by {{n}} · waiting for approval', { n: a.by }) : t('Suggested by {{n}}', { n: a.by })}
                    </p>
                  )}
                </div>
                {pending && canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon-sm" onClick={() => act('review_agenda_item', { p_item_id: a.id, p_approve: true }, t('Agenda point accepted'))} aria-label={t('Accept')}>
                      <Check />
                    </Button>
                    <Button size="icon-sm" variant="outline" onClick={() => act('review_agenda_item', { p_item_id: a.id, p_approve: false }, t('Agenda point declined'))} aria-label={t('Decline')}>
                      <X />
                    </Button>
                  </div>
                )}
                {pending && a.mine && !canManage && (
                  <Button size="icon-sm" variant="ghost" onClick={() => act('delete_agenda_suggestion', { p_item_id: a.id }, t('Suggestion withdrawn'))} aria-label={t('Withdraw')}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {hidden > 0 && <p className="mt-2 text-[12.5px] text-muted-foreground">{t('+{{n}} more', { n: hidden })}</p>}
      {canSuggest && (
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setOpen(true)}>
          <MessageSquarePlus /> {t('Suggest an agenda point')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Suggest an agenda point')}</DialogTitle>
            <DialogDescription>{t('Admins will review it. Everyone can see your suggestion and your name while it waits.')}</DialogDescription>
          </DialogHeader>
          <Field label={t('What should be discussed?')}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button onClick={send} loading={busy}>
              {t('Send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
