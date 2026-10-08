// Shared helpers for Harmony Homes Edge Functions (Deno)
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.4';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowedOrigins.includes('*') ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
    if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json(req, { error: e.message, code: e.code }, e.status);
      console.error(e);
      return json(req, { error: 'Something went wrong. Please try again.' }, 500);
    }
  };
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export const SUPABASE_URL = () => env('SUPABASE_URL');

/** Service-role client: bypasses RLS. Only ever used server-side inside these functions. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL(), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Anon client (used only to verify a user's current password) */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL(), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request, svc: SupabaseClient): Promise<User> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'Please sign in again.');
  return data.user;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid request body.');
  }
}

/** Turn a PostgREST/RPC error into a friendly HttpError */
export function rpcError(error: { message?: string; code?: string } | null): never {
  const status = error?.code === '42501' ? 403 : 400;
  throw new HttpError(status, error?.message ?? 'Request failed.', error?.code);
}

export function usernameToEmail(username: string, slug: string): string {
  return `${username.trim().toLowerCase()}@${slug.toLowerCase()}.local`;
}

/** Temporary password without look-alike characters (mirrors packages/shared/src/password.ts) */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXY34679';
export function generateTempPassword(length = 12): string {
  const out: string[] = [];
  const max = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) if (b < max && out.length < length) out.push(ALPHABET[b % ALPHABET.length]);
  }
  return out.join('');
}

export function passwordProblems(pw: string, username: string, current?: string): string[] {
  const out: string[] = [];
  if (typeof pw !== 'string' || pw.length < 8) out.push('at least 8 characters');
  if (pw && pw.length > 72) out.push('at most 72 characters');
  if (pw && username && pw.toLowerCase() === username.toLowerCase()) out.push('not your username');
  if (pw && current && pw === current) out.push('different from the current / temporary password');
  if (pw && /^\s|\s$/.test(pw)) out.push('no leading or trailing spaces');
  return out;
}
