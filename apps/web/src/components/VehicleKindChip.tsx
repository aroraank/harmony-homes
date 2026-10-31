import { Bike, Car, CircleAlert, MoreHorizontal, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { GateVehicleKind } from '@/types';

const KIND_META: Record<GateVehicleKind, { label: string; Icon: typeof Car; variant: BadgeProps['variant']; bg: string }> = {
  car: { label: 'Car', Icon: Car, variant: 'info', bg: 'bg-sky-600' },
  bike: { label: 'Bike', Icon: Bike, variant: 'lime', bg: 'bg-lime-600' },
  scooter: { label: 'Scooter', Icon: Bike, variant: 'success', bg: 'bg-emerald-600' },
  truck: { label: 'Truck', Icon: Truck, variant: 'danger', bg: 'bg-rose-600' },
  other: { label: 'Other', Icon: MoreHorizontal, variant: 'outline', bg: 'bg-slate-500' },
};

/** A guest vehicle whose type was never recorded reads as "Other" too, but flagged — a stronger colour
 *  and an alert icon instead of the plain "..." one, since an untyped entry is itself worth a second look. */
const UNRECORDED = { label: 'Other', Icon: CircleAlert, variant: 'warning' as const, bg: 'bg-amber-600' };

/**
 * Says what kind of vehicle this is, in words, not just an icon — a colour or a shape alone isn't
 * enough when bike and scooter are visually close. Shown wherever a guest vehicle appears (the gate
 * screen and the visitor log) so it never reads as a blank slot.
 */
export function VehicleKindChip({ kind, className }: { kind?: GateVehicleKind | null; className?: string }) {
  const { t } = useTranslation();
  const meta = kind ? KIND_META[kind] : UNRECORDED;
  const Icon = meta.Icon;
  return (
    <Badge variant={meta.variant} className={className}>
      <Icon className="size-3.5" />
      {t(meta.label)}
    </Badge>
  );
}

/**
 * The same information as a big, solid tile instead of a small pill — for the gate screen's "Inside
 * now" list, where the guard needs to spot the vehicle type first, from across the room. Still carries
 * the word underneath the icon (not just colour/shape) so bike and scooter stay tellable apart.
 */
export function VehicleKindTile({ kind, className }: { kind?: GateVehicleKind | null; className?: string }) {
  const { t } = useTranslation();
  const meta = kind ? KIND_META[kind] : UNRECORDED;
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        'flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl text-white',
        meta.bg,
        className,
      )}
    >
      <Icon className="size-[44%]" />
      <span className="text-[9.5px] font-bold leading-none">{t(meta.label)}</span>
    </span>
  );
}
