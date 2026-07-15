import type { ReactNode } from 'react';
import type { SupplyRequestStatus } from '@gmt-platform/contracts';
import { Badge } from '@/components/ui/badge';

/**
 * Presentación compartida del estado de una solicitud de insumos. La consumen
 * la gestión (pestaña Solicitudes de Inventario) y la vista propia del
 * trabajador (Mis insumos en Recursos): una sola fuente evita que los textos y
 * las variantes de badge diverjan entre módulos.
 */

/** Etiqueta legible (es-CL) por estado de solicitud de insumos. */
export const STATUS_LABEL: Record<SupplyRequestStatus, string> = {
  PENDIENTE: 'Pendiente',
  ENTREGADA: 'Entregada',
  RECHAZADA: 'Rechazada',
};

/** Badge de estado de una solicitud de insumos. */
export function RequestStatusBadge({ status }: { status: SupplyRequestStatus }): ReactNode {
  switch (status) {
    case 'PENDIENTE':
      return <Badge variant="warning">{STATUS_LABEL.PENDIENTE}</Badge>;
    case 'ENTREGADA':
      return <Badge variant="success">{STATUS_LABEL.ENTREGADA}</Badge>;
    case 'RECHAZADA':
      return <Badge variant="danger">{STATUS_LABEL.RECHAZADA}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
