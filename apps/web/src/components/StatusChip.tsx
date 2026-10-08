import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleDashed, Clock3, MinusCircle, PlusCircle, Slash } from 'lucide-react';
import { Badge } from './ui/badge';
import type { UnitStatus } from '@/types';

const MAP: Record<UnitStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'lime'; Icon: typeof CheckCircle2 }> = {
  paid: { label: 'Paid', variant: 'success', Icon: CheckCircle2 },
  partial: { label: 'Partial', variant: 'warning', Icon: CircleDashed },
  pending: { label: 'Pending', variant: 'danger', Icon: Clock3 },
  advance: { label: 'Advance', variant: 'lime', Icon: PlusCircle },
  waived: { label: 'Waived', variant: 'muted', Icon: Slash },
  none: { label: 'No due', variant: 'muted', Icon: MinusCircle },
  excluded: { label: 'Excluded', variant: 'muted', Icon: Slash },
  draft: { label: 'Draft', variant: 'muted', Icon: MinusCircle },
};

export function StatusChip({ status, className }: { status: UnitStatus; className?: string }) {
  const { t } = useTranslation();
  const m = MAP[status] ?? MAP.none;
  return (
    <Badge variant={m.variant} className={className}>
      <m.Icon className="size-3.5" aria-hidden />
      {t(m.label)}
    </Badge>
  );
}
