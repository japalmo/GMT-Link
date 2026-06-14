import type { ReactNode } from 'react';
import type { DocumentStatus } from '@/types/documents';
import { cn } from '@/lib/utils';

/** Etiqueta legible en español por estado de documento. */
const STATUS_LABEL: Record<DocumentStatus, string> = {
  APROBADO: 'Aprobado',
  EN_REVISION: 'En revisión',
  RECHAZADO: 'Rechazado',
  BORRADOR: 'Borrador',
};

/**
 * Chip de color para el estado de revisión de un documento personal (§6-1.5):
 * - `APROBADO` → verde
 * - `EN_REVISION` → ámbar
 * - `RECHAZADO` → rojo
 * - `BORRADOR` → gris
 */
export function DocumentStatusBadge({ status }: { status: DocumentStatus }): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'APROBADO' && 'bg-emerald-100 text-emerald-800',
        status === 'EN_REVISION' && 'bg-amber-100 text-amber-800',
        status === 'RECHAZADO' && 'bg-red-100 text-red-800',
        status === 'BORRADOR' && 'bg-muted text-muted-foreground',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Devuelve la etiqueta legible de un estado (para selects de filtro). */
export function documentStatusLabel(status: DocumentStatus): string {
  return STATUS_LABEL[status];
}
