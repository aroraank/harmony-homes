// push-dispatch: sends queued notifications as Web Push (VAPID).
// Called by the app right after an action (any signed-in user) and by pg_cron every few minutes
// with the `x-cron-secret` header. Safe to run concurrently (rows are claimed with SKIP LOCKED).
import webpush from 'npm:web-push@3.6.7';
import { handle, HttpError, json, requireUser, serviceClient } from '../_shared/http.ts';

type Sub = { endpoint: string; p256dh: string; auth: string };
type Item = {
  id: string;
  kind: string;
  ref_id: string | null;
  title: string;
  body: string | null;
  url: string | null;
  attempts: number;
  subscriptions: Sub[];
};

Deno.serve(
  handle(async (req) => {
    const svc = serviceClient();
    const cronSecret = Deno.env.get('CRON_SECRET');
    const given = req.headers.get('x-cron-secret');
    if (!(cronSecret && given && given === cronSecret)) {
      await requireUser(req, svc); // any signed-in member may nudge the queue
    }

    const pub = Deno.env.get('VAPID_PUBLIC_KEY');
    const priv = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
    if (!pub || !priv) throw new HttpError(500, 'Push is not configured (VAPID keys missing).');
    webpush.setVapidDetails(subject, pub, priv);

    let sent = 0;
    let none = 0;
    let failed = 0;
    for (let round = 0; round < 3; round++) {
      const { data, error } = await svc.rpc('_claim_push_batch', { p_limit: 100 });
      if (error) throw new HttpError(500, error.message);
      const items = (data ?? []) as Item[];
      if (!items.length) break;

      await Promise.all(
        items.map(async (n) => {
          if (!n.subscriptions.length) {
            await svc.rpc('_finish_push', { p_id: n.id, p_status: 'none', p_dead_endpoints: null });
            none++;
            return;
          }
          const payload = JSON.stringify({
            title: n.title,
            body: n.body ?? '',
            url: n.url ?? '/',
            tag: `${n.kind}:${n.ref_id ?? n.id}`,
            kind: n.kind,
          });
          const dead: string[] = [];
          let ok = 0;
          await Promise.all(
            n.subscriptions.map(async (s) => {
              try {
                await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
                  TTL: 60 * 60 * 24,
                  urgency: n.kind === 'notice' ? 'high' : 'normal',
                });
                ok++;
              } catch (e) {
                const code = (e as { statusCode?: number }).statusCode;
                if (code === 404 || code === 410) dead.push(s.endpoint);
                else console.warn('push failed', code, (e as Error).message);
              }
            }),
          );
          const status = ok > 0 ? 'sent' : dead.length === n.subscriptions.length ? 'none' : n.attempts >= 3 ? 'failed' : 'pending';
          await svc.rpc('_finish_push', { p_id: n.id, p_status: status, p_dead_endpoints: dead.length ? dead : null });
          if (status === 'sent') sent++;
          else if (status === 'failed') failed++;
          else if (status === 'none') none++;
        }),
      );
      if (items.length < 100) break;
    }
    return json(req, { sent, none, failed });
  }),
);
