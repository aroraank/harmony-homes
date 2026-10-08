import { useQuery, type QueryClient } from '@tanstack/react-query';
import { AppError, rpc, supabase } from './supabase';
import type {
  AppNotification,
  Dashboard,
  DueRow,
  EventRow,
  ExpenseCategory,
  Fund,
  PayInfo,
  Settings,
  Unit,
  UnitType,
  ContactCategory,
} from '@/types';

/** Throw a friendly error from a PostgREST response */
export function unwrap<T>(res: { data: unknown; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new AppError(res.error.message, res.error.code);
  return res.data as T;
}

export function useDashboard(societyId: string) {
  return useQuery({ queryKey: ['dashboard', societyId], queryFn: () => rpc<Dashboard>('dashboard', { p_society: societyId }) });
}

export function useUnits(societyId: string) {
  return useQuery({
    queryKey: ['units', societyId],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap<Unit[]>(
        await supabase
          .from('units')
          .select('id, society_id, code, display_name, unit_type_id, status, is_billable, sort_order, block_id, floor_id')
          .eq('society_id', societyId)
          .order('sort_order')
          .order('code'),
      ),
  });
}

export function useUnitTypes(societyId: string) {
  return useQuery({
    queryKey: ['unitTypes', societyId],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap<UnitType[]>(
        await supabase.from('unit_types').select('id, name, monthly_due_paise, sort_order').eq('society_id', societyId).order('sort_order').order('name'),
      ),
  });
}

export function useFunds(societyId: string) {
  return useQuery({
    queryKey: ['funds', societyId],
    queryFn: async () =>
      unwrap<Fund[]>(
        await supabase.from('funds').select('id, name, kind, event_id, is_active').eq('society_id', societyId).order('kind', { ascending: false }).order('created_at'),
      ),
  });
}

export function useExpenseCategories(societyId: string) {
  return useQuery({
    queryKey: ['expenseCategories', societyId],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap<ExpenseCategory[]>(
        await supabase.from('expense_categories').select('id, code, label, is_system, sort_order').eq('society_id', societyId).order('sort_order').order('label'),
      ),
  });
}

export function useContactCategories(societyId: string) {
  return useQuery({
    queryKey: ['contactCategories', societyId],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap<ContactCategory[]>(
        await supabase.from('contact_categories').select('id, name, sort_order, is_pinned').eq('society_id', societyId).order('sort_order').order('name'),
      ),
  });
}

export function useSettings(societyId: string) {
  return useQuery({
    queryKey: ['settings', societyId],
    queryFn: async () => unwrap<Settings>(await supabase.from('society_settings').select('*').eq('society_id', societyId).single()),
  });
}

export function useEvents(societyId: string) {
  return useQuery({
    queryKey: ['events', societyId],
    queryFn: async () =>
      unwrap<EventRow[]>(await supabase.from('events').select('*').eq('society_id', societyId).order('created_at', { ascending: false })),
  });
}

export function useUnitDues(unitId: string | null | undefined) {
  return useQuery({
    queryKey: ['myDues', unitId],
    enabled: !!unitId,
    queryFn: async () =>
      unwrap<DueRow[]>(await supabase.from('v_dues').select('*').eq('unit_id', unitId!).order('due_date', { ascending: false })),
  });
}

export function usePayInfo(societyId: string) {
  return useQuery({ queryKey: ['payInfo', societyId], queryFn: () => rpc<PayInfo>('my_pay_info', { p_society: societyId }) });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: ['notifications'],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () =>
      unwrap<AppNotification[]>(
        await supabase.from('notifications').select('id, kind, ref_id, title, body, url, created_at, read_at').order('created_at', { ascending: false }).limit(60),
      ),
  });
}

/** After any money change, refresh everything that shows balances or dues. */
export function invalidateMoney(qc: QueryClient) {
  for (const k of ['dashboard', 'ledger', 'myDues', 'payInfo', 'monthReport', 'unitStatement', 'defaulters', 'eventReport', 'events', 'claims', 'trend', 'funds', 'drafts', 'duesAdmin', 'preview', 'dupRef', 'receipt', 'reminderCards']) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}
