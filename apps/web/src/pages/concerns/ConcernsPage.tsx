import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Lock, MessageSquarePlus, MessageSquareWarning } from 'lucide-react';
import { relativeAge } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/input';
import { CATEGORY_TEXT, CONCERN_CATEGORIES, ConcernStatus } from './shared';
import type { Concern } from '@/types';

export default function ConcernsPage() {
  const { t } = useTranslation();
  const m = useMember();
  const [status, setStatus] = useState<'active' | 'all' | Concern['status']>('active');
  const [category, setCategory] = useState('');
  const [mineOnly, setMineOnly] = useState<'all' | 'mine' | 'assigned'>('all');

  const q = useQuery({
    queryKey: ['concerns', m.societyId, status, category, mineOnly],
    queryFn: async () => {
      let qb = supabase
        .from('v_concerns')
        .select('*')
        .eq('society_id', m.societyId)
        .order('last_message_at', { ascending: false })
        .limit(200);
      if (status === 'active') qb = qb.in('status', ['open', 'in_progress', 'resolved']);
      else if (status !== 'all') qb = qb.eq('status', status);
      if (category) qb = qb.eq('category', category);
      if (mineOnly === 'mine') qb = qb.eq('is_mine', true);
      if (mineOnly === 'assigned') qb = qb.eq('assigned_to', m.userId);
      return unwrap<Concern[]>(await qb);
    },
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={m.isAdmin ? t('Concerns inbox') : t('My concerns')}
        subtitle={
          <span className="inline-flex items-center gap-1">
            <Lock className="size-3.5" /> {t('Private: only you and the committee can see these')}
          </span>
        }
        back="/more"
        actions={
          <Button asChild size="sm">
            <Link to="/concerns/new">
              <MessageSquarePlus /> {t('New')}
            </Link>
          </Button>
        }
      />
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-10 w-auto min-w-[140px] text-sm"
          aria-label={t('Status')}
        >
          <option value="active">{t('Active')}</option>
          <option value="open">{t('Open')}</option>
          <option value="in_progress">{t('In progress')}</option>
          <option value="resolved">{t('Resolved')}</option>
          <option value="closed">{t('Closed')}</option>
          <option value="all">{t('All')}</option>
        </NativeSelect>
        {m.isAdmin && (
          <>
            <NativeSelect
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 w-auto min-w-[140px] text-sm"
              aria-label={t('Category')}
            >
              <option value="">{t('All categories')}</option>
              {CONCERN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_TEXT[c] ?? c)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={mineOnly}
              onChange={(e) => setMineOnly(e.target.value as typeof mineOnly)}
              className="h-10 w-auto min-w-[140px] text-sm"
              aria-label={t('Show')}
            >
              <option value="all">{t('Everyone')}</option>
              <option value="assigned">{t('Assigned to me')}</option>
              <option value="mine">{t('Raised by me')}</option>
            </NativeSelect>
          </>
        )}
      </div>
      <QueryState
        query={q}
        empty={(d) =>
          d.length ? null : (
            <EmptyState
              icon={<MessageSquareWarning className="size-7" />}
              title={t('No concerns here')}
              hint={t(
                'Raise anything — security, water, cleanliness or a suggestion. Only the committee sees it.',
              )}
            />
          )
        }
      >
        {(list) => (
          <div className="space-y-2">
            {list.map((c) => (
              <Link
                key={c.id}
                to={`/concerns/${c.id}`}
                className={cn(
                  'block rounded-2xl border bg-card p-3.5 shadow-card transition-colors hover:bg-secondary/50',
                  c.unread && 'border-primary/50',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p
                    className={cn(
                      'min-w-0 flex-1 break-words',
                      c.unread ? 'font-extrabold' : 'font-semibold',
                    )}
                  >
                    {c.title}
                  </p>
                  {c.unread && (
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary"
                      aria-label={t('Unread')}
                    />
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                  <ConcernStatus status={c.status} />
                  {c.priority === 'urgent' && <Badge variant="danger">{t('Urgent')}</Badge>}
                  <span>{t(CATEGORY_TEXT[c.category] ?? c.category)}</span>
                  <span>·</span>
                  <span>
                    {m.isAdmin
                      ? (c.unit_code ?? (c.hide_name ? t('Name hidden') : c.raiser_name))
                      : t('{{n}} messages', { n: c.message_count })}
                  </span>
                  <span>·</span>
                  <span>
                    {relativeAge(
                      c.status === 'open' || c.status === 'in_progress' ? c.created_at : c.last_message_at,
                    )}
                  </span>
                  {c.assignee_name && <span>· {t('Assigned to {{n}}', { n: c.assignee_name })}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
