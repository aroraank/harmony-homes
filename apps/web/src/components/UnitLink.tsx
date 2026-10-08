import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMember } from '@/lib/auth';

/** Link to a flat's statement — only the flat itself and admins may open it; for everyone else it is plain text. */
export function UnitLink({ unitId, className, children }: { unitId: string; className?: string; children: ReactNode }) {
  const m = useMember();
  if (m.isAdmin || m.unit_id === unitId) {
    return (
      <Link to={`/reports/unit/${unitId}`} className={className}>
        {children}
      </Link>
    );
  }
  return <div className={className?.replace(/hover:[^\s]+/g, '')}>{children}</div>;
}
