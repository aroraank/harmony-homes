import { rpc, supabase, VAPID_PUBLIC_KEY } from './supabase';
import { deviceLabel } from './utils';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Ask permission (must be called from a tap) and register this device for Web Push. */
export async function enablePush(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_label: deviceLabel(),
  });
  return 'granted';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Re-save the subscription after login (the same device may switch accounts). */
export async function refreshPushRegistration(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (!sub) return;
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_label: deviceLabel(),
    });
  } catch {
    /* best effort */
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Ask the push dispatcher to deliver queued notifications now (debounced, fire-and-forget). */
export function nudgePush(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void supabase.functions.invoke('push-dispatch', { body: {} }).catch(() => undefined);
  }, 800);
}
