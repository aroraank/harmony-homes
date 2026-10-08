import { createClient } from '@supabase/supabase-js';
import { isViewingAs, READ_ONLY_RPCS, SILENT_SKIP_RPCS } from './viewAsState';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'hh-auth',
  },
  global: { headers: { 'x-client-info': 'harmony-homes-web' } },
});

export const DEFAULT_SOCIETY_SLUG = ((import.meta.env.VITE_DEFAULT_SOCIETY_SLUG as string | undefined) ?? '').trim();
export const VAPID_PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
  get isDuplicateReference() {
    return this.message.startsWith('DUPLICATE_REFERENCE');
  }
  get isPermission() {
    return this.code === '42501' || this.status === 403;
  }
}

function friendly(message: string | undefined): string {
  if (!message) return 'Something went wrong. Please try again.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return "Can't reach the server. Check your internet connection.";
  if (/JWT expired|invalid JWT/i.test(message)) return 'Your session expired. Please sign in again.';
  return message.replace(/^DUPLICATE_REFERENCE:\s*/, '');
}

/** Call a Postgres RPC and throw a friendly AppError on failure. */
export const VIEW_ONLY_MESSAGE = 'View only: you are viewing as another member. Switch back to your own account to make changes.';

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (isViewingAs() && !READ_ONLY_RPCS.has(fn)) {
    if (SILENT_SKIP_RPCS.has(fn)) return undefined as T;
    throw new AppError(VIEW_ONLY_MESSAGE, '42501');
  }
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) {
    const e = new AppError(error.message.startsWith('DUPLICATE_REFERENCE') ? error.message : friendly(error.message), error.code);
    throw e;
  }
  return data as T;
}

/** Call an Edge Function; surfaces the function's JSON { error } message. */
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (isViewingAs()) throw new AppError(VIEW_ONLY_MESSAGE, '42501');
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    let status: number | undefined;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      status = ctx.status;
      try {
        const j = await ctx.json();
        if (j?.error) message = j.error;
      } catch {
        /* ignore */
      }
    }
    throw new AppError(friendly(message), undefined, status);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message.replace(/^DUPLICATE_REFERENCE:\s*/, '');
  if (e instanceof Error) return friendly(e.message);
  return 'Something went wrong. Please try again.';
}

/** A fresh idempotency key per submit attempt (the RPC returns the same entry if retried). */
export function newIdemKey(prefix = 'web'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
