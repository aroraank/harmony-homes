import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Bell, CheckCheck } from 'lucide-react';
import { relativeAge } from '@harmony/shared';
import { rpc } from '@/lib/supabase';
import { useNotifications } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;

  const markAll = async () => {
    await rpc('mark_notifications_read', { p_ids: null }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Notifications')}
        back
        actions={
          unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll}>
              <CheckCheck /> {t('Mark all read')}
            </Button>
          )
        }
      />
      <QueryState query={q} empty={(d) => (d.length ? null : <EmptyState icon={<Bell className="size-7" />} title={t('You are all caught up')} />)}>
        {(list) => (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
            {list.map((n, i) => (
              <button
                key={n.id}
                type="button"
                onClick={async () => {
                  if (!n.read_at) {
                    await rpc('mark_notifications_read', { p_ids: [n.id] }).catch(() => undefined);
                    void qc.invalidateQueries({ queryKey: ['notifications'] });
                  }
                  if (n.url) nav(n.url);
                }}
                className={cn('flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left hover:bg-secondary/50', i > 0 && 'border-t', !n.read_at && 'bg-primary/[0.04]')}
              >
                <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-[14.5px]', n.read_at ? 'font-medium' : 'font-bold')}>{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[11.5px] text-muted-foreground">{relativeAge(n.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}
