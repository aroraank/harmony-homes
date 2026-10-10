import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, Send } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useAuth, useMember } from '@/lib/auth';
import { errorMessage, rpc } from '@/lib/supabase';
import { setLocal } from '@/lib/storage';
import { FEEDBACK_SENT_KEY } from '@/lib/feedback';
import { cn } from '@/lib/utils';
import { PageHeader, SectionTitle } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';

type Rating = 'best' | 'good' | 'bad';
type Row = {
  id: string;
  rating: Rating;
  comment: string;
  created_at: string;
  unit_code: string | null;
  name: string | null;
};

const RATINGS: { key: Rating; emoji: string; label: string; on: string }[] = [
  { key: 'best', emoji: '😍', label: 'Best', on: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/15' },
  { key: 'good', emoji: '🙂', label: 'Good', on: 'border-sky-500 bg-sky-50 dark:bg-sky-500/15' },
  { key: 'bad', emoji: '🙁', label: 'Bad', on: 'border-rose-500 bg-rose-50 dark:bg-rose-500/15' },
];

/** Any member: rate the app and suggest features. Only the super admin can read what was sent. */
export default function FeedbackPage() {
  const { t } = useTranslation();
  const m = useMember();
  const { viewOnly } = useAuth();
  const qc = useQueryClient();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = !!rating && comment.trim().length >= 5;

  const send = async () => {
    if (!rating) return toast.error(t('Please choose Best, Good or Bad.'));
    if (comment.trim().length < 5)
      return toast.error(t('Please write your comment (at least 5 characters).'));
    setBusy(true);
    try {
      await rpc('submit_app_feedback', {
        p_society: m.societyId,
        p_rating: rating,
        p_comment: comment.trim(),
      });
      setLocal(FEEDBACK_SENT_KEY, new Date().toISOString());
      setRating(null);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['appFeedback'] });
      toast.success(t('Thank you! Your feedback has been sent.'));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('App feedback')}
        subtitle={t('Tell us what you like, what is missing, and what new feature you would like')}
        back="/more"
      />

      <Card className="space-y-4 p-4">
        <div>
          <p className="mb-2 text-sm font-bold">{t('How do you find the app?')}</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('Rating')}>
            {RATINGS.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={rating === r.key}
                onClick={() => setRating(r.key)}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-2xl border-2 bg-card py-3 transition-colors',
                  rating === r.key ? r.on : 'border-border hover:bg-secondary/50',
                )}
              >
                <span className="text-3xl leading-none">{r.emoji}</span>
                <span className="text-[13px] font-bold">{t(r.label)}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="fb-comment" className="mb-2 block text-sm font-bold">
            {t('Your comment or suggestion')} <span className="text-destructive">*</span>
          </label>
          <Textarea
            id="fb-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            placeholder={t('e.g. It would help if the app could… / I found it hard to…')}
          />
          <p className="mt-1 text-right text-[11.5px] text-muted-foreground">{comment.length}/1000</p>
        </div>
        <p className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          <Lock className="size-3.5 shrink-0" />
          {t('Only the super admin can read this. Your flat number is sent with it.')}
        </p>
        <Button
          className="w-full"
          size="lg"
          loading={busy}
          disabled={!ready || viewOnly}
          onClick={() => void send()}
        >
          {!busy && <Send />} {t('Send feedback')}
        </Button>
      </Card>

      {m.isSuperAdmin && <FeedbackInbox />}
    </div>
  );
}

function FeedbackInbox() {
  const { t } = useTranslation();
  const m = useMember();
  const [filter, setFilter] = useState<Rating | ''>('');
  const q = useQuery({
    queryKey: ['appFeedback', m.societyId],
    queryFn: () => rpc<Row[]>('app_feedback_list', { p_society: m.societyId }),
  });
  const rows = q.data ?? [];
  const count = (r: Rating) => rows.filter((x) => x.rating === r).length;
  const shown = filter ? rows.filter((x) => x.rating === filter) : rows;
  return (
    <section className="mt-5">
      <SectionTitle>{t('Feedback received ({{n}})', { n: rows.length })}</SectionTitle>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {RATINGS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setFilter(filter === r.key ? '' : r.key)}
            className={cn(
              'cursor-pointer rounded-2xl border-2 bg-card py-2 text-center',
              filter === r.key ? r.on : 'border-border',
            )}
          >
            <p className="text-xl leading-none">{r.emoji}</p>
            <p className="tabular mt-1 text-[15px] font-extrabold">{count(r.key)}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">{t(r.label)}</p>
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('No feedback yet')}</p>
      ) : (
        <Card className="divide-y">
          {shown.map((x) => {
            const r = RATINGS.find((y) => y.key === x.rating);
            return (
              <div key={x.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg leading-none">{r?.emoji}</span>
                  <span className="text-[13px] font-bold">
                    {x.unit_code ?? t('No flat')}
                    {x.name ? ` · ${x.name}` : ''}
                  </span>
                  <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">
                    {formatDateTime(x.created_at)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px]">{x.comment}</p>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
