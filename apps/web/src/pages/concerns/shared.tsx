import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { Concern } from '@/types';

export const CONCERN_CATEGORIES = ['security', 'cleanliness', 'water', 'electricity', 'payments', 'neighbour', 'suggestion', 'other'] as const;

export const CATEGORY_TEXT: Record<string, string> = {
  security: 'Security',
  cleanliness: 'Cleanliness',
  water: 'Water',
  electricity: 'Electricity',
  payments: 'Payments',
  neighbour: 'Neighbour issue',
  suggestion: 'Suggestion',
  other: 'Other',
};

export function ConcernStatus({ status }: { status: Concern['status'] }) {
  const { t } = useTranslation();
  const map = {
    open: ['Open', 'warning'],
    in_progress: ['In progress', 'info'],
    resolved: ['Resolved', 'success'],
    closed: ['Closed', 'muted'],
  } as const;
  const [label, variant] = map[status];
  return <Badge variant={variant}>{t(label)}</Badge>;
}
