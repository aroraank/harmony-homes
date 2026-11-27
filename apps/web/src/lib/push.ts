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

class PushTimeoutError extends Error {
  constructor(stage: string) {
    super(`Timed out waiting for: ${stage}`);
    this.name = 'PushTimeoutError';
  }
}

/** Reject with a clear "timed out at X" error instead of leaving a promise to hang forever silently. */
function withTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new PushTimeoutError(stage)), ms)),
  ]);
}

/**
 * Wait for the service worker to be ready, but don't hang forever: right after a fresh
 * install the SW has to download and precache the whole app before it's "active", which
 * can stall on a slow or flaky connection. Nudge it along and give up after a while so the
 * caller can show a retry instead of spinning indefinitely.
 */
async function waitForServiceWorker(timeoutMs = 20_000): Promise<ServiceWorkerRegistration> {
  void navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => undefined);
  return withTimeout(navigator.serviceWorker.ready, timeoutMs, 'service worker install');
}

/**
 * Ask permission (must be called from a tap) and register this device for Web Push.
 * Every network-dependent step has its own timeout so a stuck step raises a specific,
 * catchable error (via PushTimeoutError) instead of leaving the caller spinning forever
 * with no way to tell what actually stalled.
 */
export async function enablePush(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!pushSupported()) {
    console.log('[push] unsupported on this browser');
    return 'unsupported';
  }
  console.log('[push] requesting Notification permission...');
  const perm = await Notification.requestPermission();
  console.log('[push] permission result:', perm);
  if (perm !== 'granted') {
    if (perm === 'denied') markPushBlocked();
    return 'denied';
  }
  console.log('[push] waiting for service worker to be ready...');
  const reg = await waitForServiceWorker();
  console.log('[push] service worker ready, scope:', reg.scope);
  let sub = await reg.pushManager.getSubscription();
  console.log('[push] existing subscription:', sub ? sub.endpoint : 'none');
  if (!sub) {
    console.log('[push] calling pushManager.subscribe()...');
    // On some networks (carrier/firewall blocking Google's push service) this call can hang
    // indefinitely rather than reject — give it a hard ceiling so we get a real error instead.
    sub = await withTimeout(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      }),
      20_000,
      'push service registration',
    );
    console.log('[push] subscribed:', sub.endpoint);
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  console.log('[push] saving subscription to server...');
  await withTimeout(
    rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_label: deviceLabel(),
    }),
    15_000,
    'saving device to server',
  );
  console.log('[push] done — notifications enabled');
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

/**
 * Once a browser is blocked, no button can ever re-trigger the native permission prompt again —
 * that's a platform rule, not something this app controls. Call this when that state is detected
 * so the admin report shows a real "Off" instead of "Not decided".
 */
export function markPushBlocked(): void {
  void rpc('set_push_opt_in', { p_value: false }).catch(() => undefined);
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Ask the push dispatcher to deliver queued notifications now (debounced, fire-and-forget). */
export function nudgePush(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    void supabase.functions.invoke('push-dispatch', { body: {} }).catch(() => undefined);
  }, 800);
}
