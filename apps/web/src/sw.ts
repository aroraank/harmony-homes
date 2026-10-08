/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// SPA: serve the app shell for in-app navigations (works offline)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Society QR images and attachments are fetched via short-lived signed URLs; cache images briefly for offline viewing.
registerRoute(
  ({ url, request }) => request.destination === 'image' && url.pathname.includes('/storage/v1/object/sign/'),
  new CacheFirst({ cacheName: 'hh-images', plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 })] }),
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

type PushPayload = { title?: string; body?: string; url?: string; tag?: string; kind?: string };

self.addEventListener('push', (event) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { title: 'Harmony Homes', body: event.data?.text() };
  }
  const title = data.title || 'Harmony Homes';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url ?? '/' },
      requireInteraction: data.kind === 'notice',
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data?.url as string) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          if ('navigate' in c) await (c as WindowClient).navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
