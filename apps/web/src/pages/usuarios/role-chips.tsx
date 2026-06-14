import type { ReactNode } from 'react';
import type { RoleKey } from '@gtm-link/shared-types';
import { roleLabel } from '@/lib/role-labels';

/**
 * Lista de chips de rol legibles. Si el usuario no tiene roles, muestra un
 * guion apagado. Cada chip usa la etiqueta de {@link roleLabel}.
 */
export function RoleChips({ roleKeys }: { roleKeys: readonly RoleKey[] }): ReactNode {
  if (roleKeys.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roleKeys.map((role) => (
        <span
          key={role}
          className="inline-flex items-center whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          {roleLabel(role)}
        </span>
      ))}
    </div>
  );
}
