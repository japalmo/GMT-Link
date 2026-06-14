import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Chip que distingue el tipo de persona en el directorio:
 * - Colaborador (interno) → neutro.
 * - Cliente (externo) → acento azul, para diferenciarlo de un vistazo.
 */
export function TypeBadge({ isClientUser }: { isClientUser: boolean }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        isClientUser
          ? 'bg-blue-100 text-blue-800'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      {isClientUser ? 'Cliente' : 'Colaborador'}
    </span>
  );
}
