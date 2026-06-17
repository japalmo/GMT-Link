import type { ReactNode } from 'react';
import type { UserStatus } from '@gmt-link/shared-types';
import { statusLabel } from '@/lib/role-labels';
import { cn } from '@/lib/utils';

/**
 * Chip de color para el estado de un usuario:
 * - `PENDING_FIRST_LOGIN` → ámbar
 * - `ACTIVE` → verde
 * - `SUSPENDED` → rojo
 */
export function StatusBadge({ status }: { status: UserStatus }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'ACTIVE' && 'bg-emerald-100 text-emerald-800',
        status === 'PENDING_FIRST_LOGIN' && 'bg-amber-100 text-amber-800',
        status === 'SUSPENDED' && 'bg-red-100 text-red-800',
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
