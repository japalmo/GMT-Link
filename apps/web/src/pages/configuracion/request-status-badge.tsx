import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { PermissionRequestStatus } from '@/types/settings';

/** Etiqueta legible (es-CL) por estado de solicitud. */
const STATUS_LABEL: Record<PermissionRequestStatus, string> = {
  PENDIENTE: 'Pendiente',
  APROBADA: 'Aprobada',
  RECHAZADA: 'Rechazada',
};

/**
 * Chip de color para el estado de una solicitud de acceso (§6-2.3):
 * - `APROBADA` → verde
 * - `PENDIENTE` → ámbar
 * - `RECHAZADA` → rojo
 */
export function RequestStatusBadge({
  status,
}: {
  status: PermissionRequestStatus;
}): ReactNode {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'APROBADA' && 'bg-emerald-100 text-emerald-800',
        status === 'PENDIENTE' && 'bg-amber-100 text-amber-800',
        status === 'RECHAZADA' && 'bg-red-100 text-red-800',
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
