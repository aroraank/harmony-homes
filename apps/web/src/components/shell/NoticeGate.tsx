import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, MapPin, Megaphone, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime } from '@harmony/shared';
import { useMember } from '@/lib/auth';
import { errorMessage, rpc, supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/queries';
import { useOnline } from '@/lib/online';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RichText } from '../RichText';
import { AttachmentButton } from '../AttachmentButton';
import type { Notice } from '@/types';

type Pending = { id: string; notice_id: string; opened_at: string | null; notices: Notice };

function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/** Unacknowledged notices block the app until the member taps OK. */
export function NoticeGate() {
  const { t } = useTranslation();
  const m = useMember();
  const qc = useQueryClient();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  // The member must scroll to the end of the notice before OK is enabled.
  const [readTo, setReadTo] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const q = useQuery({
    queryKey: ['pendingAcks', m.societyId, m.userId],
    refetchInterval: 120_000,
    queryFn: async () =>
      unwrap<Pending[]>(
        await supabase
          .from('notice_receipts')
          .select('id, notice_id, opened_at, notices!inner(*)')
          .eq('user_id', m.userId)
          .eq('society_id', m.societyId)
          .is('acknowledged_at', null)
          .eq('notices.require_ack', true)
          .is('notices.archived_at', null)
          .order('id'),
      ),
  });

  const current = (q.data ?? []).sort((a, b) => a.notices.created_at.localeCompare(b.notices.created_at))[0];

  useEffect(() => {
    if (current && !current.opened_at) void rpc('mark_notice_opened', { p_notice_id: current.notice_id }).catch(() => undefined);
  }, [current]);

  useEffect(() => {
    void rpc('mark_notices_delivered', { p_society: m.societyId }).catch(() => undefined);
  }, [m.societyId]);

  const checkEnd = useCallback(() => {
    const el = boxRef.current;
    if (!el || !current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadTo(current.notice_id);
  }, [current]);

  // short notices that fit without scrolling count as read; re-check when content/images load
  const roRef = useRef<ResizeObserver | null>(null);
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      roRef.current?.disconnect();
      roRef.current = null;
      if (!el) return;
      const ro = new ResizeObserver(() => checkEnd());
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
      roRef.current = ro;
      requestAnimationFrame(() => checkEnd());
    },
    [checkEnd],
  );
  useEffect(() => () => roRef.current?.disconnect(), []);

  if (!current) return null;
  const n = current.notices;
  const readAll = readTo === current.notice_id;

  const acknowledge = async () => {
    setBusy(true);
    try {
      const pos = await getPosition();
      await rpc('acknowledge_notice', {
        p_notice_id: n.id,
        p_lat: pos?.coords.latitude ?? null,
        p_lng: pos?.coords.longitude ?? null,
        p_accuracy: pos?.coords.accuracy ?? null,
      });
      await q.refetch();
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['notices'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent dismissible={false} aria-describedby="notice-gate-desc">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Megaphone className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Please read this notice')}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
          </div>
          {n.priority === 'important' && <Badge variant="danger">{t('Important')}</Badge>}
        </div>
        <DialogTitle className="text-xl">{n.title}</DialogTitle>
        <DialogDescription id="notice-gate-desc" className="sr-only">
          {t('You must acknowledge this notice to continue.')}
        </DialogDescription>
        <div
          ref={setBox}
          onScroll={checkEnd}
          tabIndex={0}
          aria-label={t('Notice text')}
          className="mt-3 max-h-[45vh] overflow-y-auto rounded-xl border bg-muted/20 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div>
            <RichText text={n.body} className="text-[15px]" />
            {n.attachment_path && (
              <div className="mt-3">
                <AttachmentButton path={n.attachment_path} />
              </div>
            )}
          </div>
        </div>
        {!readAll && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-warning" role="status">
            <ArrowDown className="size-4 animate-bounce" /> {t('Scroll to the end to continue')}
          </p>
        )}
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[12.5px] text-muted-foreground">
          <MapPin className="mt-0.5 size-4 shrink-0" />
          {t('When you tap OK, your phone may ask to share your location once. It is optional and only records where this notice was acknowledged.')}
        </p>
        <Button className="mt-4 w-full" size="xl" onClick={acknowledge} loading={busy} disabled={!online || !readAll}>
          <ShieldCheck /> {t('I have read this — OK')}
        </Button>
        {(q.data?.length ?? 0) > 1 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">{t('{{count}} more notices after this', { count: (q.data?.length ?? 1) - 1 })}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
