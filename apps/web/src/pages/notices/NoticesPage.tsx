import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCheck, Megaphone, Plus, Search } from 'lucide-react';
import { formatDateTime, plainPreview } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, QueryState } from '@/components/States';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { Notice } from '@/types';

type Rec = { notice_id: string; user_id: string; acknowledged_at: string | null };

export default function NoticesPage() {
  const { t } = useTranslation();
  const m = useMember();
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);

  const q = useQuery({
    queryKey: ['notices', m.societyId, archived, search],
    queryFn: async () => {
      let qb = supabase.from('notices').select('*').eq('society_id', m.societyId).order('created_at', { ascending: false }).limit(100);
      qb = archived ? qb.not('archived_at', 'is', null) : qb.is('archived_at', null);
      const s = search.trim().replace(/[%,()]/g, '');
      if (s) qb = qb.or(`title.ilike.%${s}%,body.ilike.%${s}%`);
      const notices = unwrap<Notice[]>(await qb);
      const ids = notices.map((n) => n.id);
      const recs = ids.length ? unwrap<Rec[]>(await supabase.from('notice_receipts').select('notice_id, user_id, acknowledged_at').in('notice_id', ids)) : [];
      return { notices, recs };
    },
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={t('Notices')}
        actions={
          m.can('send_notices') && (
            <Button asChild size="sm">
              <Link to="/notices/new">
                <Plus /> {t('New')}
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search notices')} className="pl-10" aria-label={t('Search notices')} />
        </div>
        {m.isAdmin && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
            <Switch checked={archived} onCheckedChange={setArchived} aria-label={t('Archived')} />
            {t('Archived')}
          </label>
        )}
      </div>
      <QueryState
        query={q}
        empty={(d) => (d.notices.length ? null : <EmptyState icon={<Megaphone className="size-7" />} title={t('No notices')} hint={t('Society announcements will appear here.')} />)}
      >
        {({ notices, recs }) => (
          <div className="space-y-2.5">
            {notices.map((n) => {
              const mine = recs.find((r) => r.notice_id === n.id && r.user_id === m.userId);
              const all = recs.filter((r) => r.notice_id === n.id);
              const acked = all.filter((r) => r.acknowledged_at).length;
              return (
                <Link
                  key={n.id}
                  to={`/notices/${n.id}`}
                  className={cn(
                    'block rounded-2xl border bg-card p-4 shadow-card transition-colors hover:bg-secondary/50',
                    mine && !mine.acknowledged_at && n.require_ack && 'border-primary/50 ring-1 ring-primary/30',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold leading-snug">{n.title}</p>
                    {n.priority === 'important' && <Badge variant="danger">{t('Important')}</Badge>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{plainPreview(n.body, 160)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                    <span>{formatDateTime(n.created_at)}</span>
                    {mine?.acknowledged_at && (
                      <Badge variant="success">
                        <CheckCheck className="size-3.5" /> {t('Acknowledged')}
                      </Badge>
                    )}
                    {m.isAdmin && all.length > 0 && (
                      <Badge variant="secondary" className="tabular">
                        {t('{{a}}/{{n}} acknowledged', { a: acked, n: all.length })}
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </QueryState>
    </div>
  );
}
