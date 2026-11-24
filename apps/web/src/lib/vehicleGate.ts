import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/supabase';
import type {
  FeeChangePrompt,
  GateVisitLogResult,
  MyApprovalSpeed,
  UnitOption,
  VehicleApproval,
  VehicleApprovalStatRow,
  VehicleGate,
  VehicleRow,
} from '@/types';

/** Everyone's vehicles (the society directory). Lives here, not in the lazy Vehicles page, so the popups can use it. */
export function useVehicles(societyId: string) {
  return useQuery({
    queryKey: ['vehicles', societyId],
    queryFn: () => rpc<VehicleRow[]>('vehicle_directory', { p_society: societyId }),
  });
}

/** Which vehicle popup (if any) this flat should see: ask (skippable), force (home page only) or the 3-monthly review. */
export function useVehicleGate(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['vehicleGate', societyId],
    enabled,
    staleTime: 0, // re-check on every open/focus so a change reaches an already-logged-in member
    queryFn: () => rpc<VehicleGate>('my_vehicle_gate', { p_society: societyId }),
  });
}

/** Guest vehicles waiting at the gate for this flat (or, for an admin, the whole society) to approve. */
export function useVehicleApprovals(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['vehicleApprovals', societyId],
    enabled,
    refetchInterval: 20_000,
    staleTime: 0,
    queryFn: () => rpc<VehicleApproval[]>('my_vehicle_approvals', { p_society: societyId }),
  });
}

export type GateVisitLogFilters = {
  plate?: string;
  unitId?: string | null;
  since?: string | null;
  limit?: number;
};

/** The searchable gate-visit history — a resident's own flat only, or (admin/guard) the whole society. */
export function useGateVisitLog(societyId: string, filters: GateVisitLogFilters, enabled = true) {
  return useQuery({
    queryKey: ['gateVisitLog', societyId, filters],
    enabled: enabled && !!societyId,
    placeholderData: keepPreviousData,
    queryFn: () =>
      rpc<GateVisitLogResult>('gate_visit_log', {
        p_society: societyId,
        p_plate: filters.plate?.trim() || null,
        p_unit_id: filters.unitId || null,
        p_since: filters.since || null,
        p_limit: filters.limit ?? 50,
        p_offset: 0,
      }),
  });
}

/** Flats list for the "filter by flat" dropdown (admin / super admin / guard only). */
export function useSocietyUnitOptions(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['societyUnitOptions', societyId],
    enabled: enabled && !!societyId,
    staleTime: 10 * 60_000,
    queryFn: () => rpc<UnitOption[]>('society_unit_options', { p_society: societyId }),
  });
}

/** Admin/super-admin report: every flat's average guest-vehicle approval response time, slowest first. */
export function useVehicleApprovalStats(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['vehicleApprovalStats', societyId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => rpc<VehicleApprovalStatRow[]>('vehicle_approval_stats', { p_society: societyId }),
  });
}

/** A resident's own "fun fact": their average response time, and only the flats quicker than them. */
export function useMyApprovalSpeed(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['myApprovalSpeed', societyId],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: () => rpc<MyApprovalSpeed>('my_approval_speed', { p_society: societyId }),
  });
}

/** The maintenance-change notice: residents must acknowledge it, admins only see it and can close it. */
export function useFeeChangePrompt(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['feeChangePrompt', societyId],
    enabled,
    staleTime: 0,
    queryFn: () => rpc<FeeChangePrompt>('my_fee_change_prompt', { p_society: societyId }),
  });
}
