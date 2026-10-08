import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc, supabase } from './supabase';
import { getLocal, setLocal } from './storage';
import { setLanguage } from './i18n';
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

  // keep UI language in sync with the profile preference
  useEffect(() => {
    const loc = ctx?.profile?.locale;
    if (loc && !getLocal('hh-lang')) setLanguage(loc);
  }, [ctx?.profile?.locale]);

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
