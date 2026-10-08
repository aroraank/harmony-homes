import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc, supabase } from './supabase';
import { getLocal, setLocal } from './storage';
import i18n, { setLanguage } from './i18n';
import { getViewAs, setViewAs, type ViewAsState } from './viewAsState';
import type { Membership, MyContext, Permission } from '@/types';

interface AuthValue {
  loading: boolean;
  session: Session | null;
  ctx: MyContext | null;
  ctxLoading: boolean;
  ctxError: unknown;
  active: Membership | null;
  memberships: Membership[];
  setActiveSociety: (societyId: string) => void;
  refreshContext: () => Promise<void>;
  signOut: () => Promise<void>;
  /** true for a super admin "View as" session (read-only) */
  viewOnly: boolean;
  viewAs: ViewAsState | null;
}

/** Sign-in methods recorded in the access token (password for normal logins, otp for "View as"). */
function tokenMethods(token: string | undefined): string[] {
  if (!token) return [];
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (p.amr ?? []).map((a: { method?: string }) => a.method ?? '');
  } catch {
    return [];
  }
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(() => getLocal('hh-society'));

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;
  const ctxQuery = useQuery({
    queryKey: ['ctx', userId],
    queryFn: () => rpc<MyContext>('my_context'),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const ctx = ctxQuery.data ?? null;
  const memberships = useMemo(() => (ctx?.memberships ?? []).filter((m) => m.status === 'active'), [ctx]);
  const active = useMemo(() => memberships.find((m) => m.society_id === activeId) ?? memberships[0] ?? null, [memberships, activeId]);

  const methods = tokenMethods(session?.access_token);
  const viewOnly = methods.length > 0 && !methods.includes('password') && methods.some((x) => x === 'otp' || x === 'magiclink');
  // a normal password sign-in always ends any leftover "View as" state
  useEffect(() => {
    if (session && !viewOnly && getViewAs()) setViewAs(null);
  }, [session, viewOnly]);
  const viewAs = viewOnly ? getViewAs() : null;

  // Each member's language choice is saved on their profile and follows them to any phone.
  // If they picked a language on the login screen just now, that choice is saved instead.
  const langSynced = useRef<string | null>(null);
  useEffect(() => {
    const loc = ctx?.profile?.locale;
    if (!loc || !userId || viewOnly || langSynced.current === userId) return;
    langSynced.current = userId;
    const current = i18n.language === 'hi' ? 'hi' : 'en';
    let picked = false;
    try {
      picked = window.sessionStorage.getItem('hh-lang-picked') === '1';
      window.sessionStorage.removeItem('hh-lang-picked');
    } catch {
      /* ignore */
    }
    if (picked && current !== loc) void rpc('set_my_locale', { p_locale: current }).catch(() => undefined);
    else if (loc !== current) setLanguage(loc);
  }, [ctx?.profile?.locale, userId, viewOnly]);

  const setActiveSociety = useCallback(
    (id: string) => {
      setLocal('hh-society', id);
      setActiveId(id);
      void qc.invalidateQueries();
    },
    [qc],
  );

  const refreshContext = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['ctx'] });
    await ctxQuery.refetch();
  }, [qc, ctxQuery]);

  const signOut = useCallback(async () => {
    // scope 'local' signs out only this device; other phones stay signed in.
    await supabase.auth.signOut({ scope: 'local' });
    qc.clear();
    setLocal('hh-cache', null);
    setSession(null);
  }, [qc]);

  const value: AuthValue = {
    loading,
    session,
    ctx,
    ctxLoading: ctxQuery.isLoading,
    ctxError: ctxQuery.error,
    active,
    memberships,
    setActiveSociety,
    refreshContext,
    signOut,
    viewOnly,
    viewAs,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

/** The active society membership with permission helpers. Only use inside the signed-in shell. */
export function useMember() {
  const { active, ctx } = useAuth();
  if (!active) throw new Error('No active membership');
  const can = (p: Permission) => active.role === 'super_admin' || active.permissions.includes(p);
  return {
    ...active,
    societyId: active.society_id,
    userId: ctx?.user_id ?? '',
    fullName: ctx?.profile?.full_name ?? '',
    isAdmin: active.role === 'admin' || active.role === 'super_admin',
    isSuperAdmin: active.role === 'super_admin',
    can,
  };
}
