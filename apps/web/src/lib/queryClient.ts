import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { AppError } from './supabase';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7, // keep for offline reading
      retry: (count, err) => !(err instanceof AppError && err.isPermission) && count < 2,
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'online', retry: false },
  },
});

/** Offline read cache: the last dashboard, ledger and dues stay viewable without a connection. */
export const persister = createSyncStoragePersister({
  key: 'hh-cache',
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  })(),
  throttleTime: 2000,
});

/** Only persist screens that make sense offline, never admin-only or private data like concerns. */
export function shouldPersist(queryKey: readonly unknown[]): boolean {
  const k = String(queryKey[0]);
  return ['ctx', 'dashboard', 'ledger', 'myDues', 'notices', 'events', 'payInfo', 'monthReport'].includes(k);
}
