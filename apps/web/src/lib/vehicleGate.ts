import { useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/supabase';
import type { FeeChangePrompt, VehicleGate, VehicleRow } from '@/types';

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

/** The maintenance-change notice: residents must acknowledge it, admins only see it and can close it. */
export function useFeeChangePrompt(societyId: string, enabled = true) {
  return useQuery({
    queryKey: ['feeChangePrompt', societyId],
    enabled,
    staleTime: 0,
    queryFn: () => rpc<FeeChangePrompt>('my_fee_change_prompt', { p_society: societyId }),
  });
}
