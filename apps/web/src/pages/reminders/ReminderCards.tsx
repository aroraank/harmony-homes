import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRing, CheckCircle2, Clock, Phone, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ReminderCard } from '@/types';

export function useReminderCards() {
  const m = useMember();
  return useQuery({
    queryKey: ['reminderCards', m.societyId],
    queryFn: () => rpc<ReminderCard[]>('my_reminder_cards', { p_society: m.societyId }),
  });
}

/** In-app reminder cards: advisory ones are optional for each flat; society tasks are for admins. */
export function ReminderCards({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useReminderCards();
  const respond = useMutation({
    mutationFn: (v: { id: string; response: 'done' | 'snooze' }) => rpc('respond_reminder', { p_occurrence_id: v.id, p_response: v.response }),
    onSuccess: (_d, v) => {
      toast.success(v.response === 'done' ? t('Marked done for your flat') : t('We will remind you in a month'));
      void qc.invalidateQueries({ queryKey: ['reminderCards'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cards = q.data ?? [];
  if (!cards.length) return null;
  return (
    <div className="space-y-2.5">
      {cards.slice(0, compact ? 2 : 20).map((c) => (
        <Card key={c.occurrence_id} className="border-lime-300/60 bg-gradient-to-br from-lime-50 to-card p-4 dark:from-lime-400/10">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-lime-300 text-lime-950">
              {c.kind === 'task' ? <Wrench className="size-5" /> : <BellRing className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{c.title}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{c.message}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {c.kind === 'task' ? t('Society task · due {{d}}', { d: formatDate(c.due_date) }) : t('Optional for your flat · {{d}}', { d: formatDate(c.due_date) })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {c.kind === 'advisory' ? (
                  <>
                    <Button size="sm" onClick={() => respond.mutate({ id: c.occurrence_id, response: 'done' })} disabled={respond.isPending}>
                      <CheckCircle2 /> {t('Done for my flat')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => respond.mutate({ id: c.occurrence_id, response: 'snooze' })} disabled={respond.isPending}>
                      <Clock /> {t('Remind me in 1 month')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" asChild>
                    <Link to={`/reminders?task=${c.schedule_id}`}>
                      <CheckCircle2 /> {t('Mark task done')}
                    </Link>
                  </Button>
                )}
                {c.contact_category_id && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/contacts?category=${c.contact_category_id}`}>
                      <Phone /> {t('Contacts')}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
