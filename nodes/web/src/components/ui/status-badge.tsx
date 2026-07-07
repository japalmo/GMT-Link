import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';

/** Variante de estado disponible (subconjunto de las variantes de `Badge`). */
type StatusVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** Entrada de un mapa de estado: etiqueta legible (es-CL) + variante de color. */
interface StatusMeta {
  readonly label: string;
  readonly variant: StatusVariant;
}

/* -------------------------------------------------------------------------- *
 * Uniones de estado por dominio.
 * Reúnen los estados de los 4 *-status-badge existentes (documentos, finanzas,
 * usuarios, configuración/solicitudes) sin perder ninguno.
 * -------------------------------------------------------------------------- */

/** Estados de documento personal (`@/types/documents` → `DocumentStatus`). */
export type DocumentStatusValue =
  | 'BORRADOR'
  | 'EN_REVISION'
  | 'APROBADO'
  | 'RECHAZADO';

/** Estados de finanzas (`@/types/finance` → `FinanceStatus`). */
export type FinanceStatusValue =
  | 'PENDIENTE'
  | 'APROBADO'
  | 'PAGADO'
  | 'RECHAZADO';

/** Estados de usuario (`@gmt-platform/contracts` → `UserStatus`). */
export type UserStatusValue = 'PENDING_FIRST_LOGIN' | 'ACTIVE' | 'SUSPENDED';

/** Estados de solicitud de acceso (`@/types/settings` → `PermissionRequestStatus`). */
export type RequestStatusValue = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

const DOCUMENT_STATUS: Record<DocumentStatusValue, StatusMeta> = {
  BORRADOR: { label: 'Borrador', variant: 'neutral' },
  EN_REVISION: { label: 'En revisión', variant: 'warning' },
  APROBADO: { label: 'Aprobado', variant: 'success' },
  RECHAZADO: { label: 'Rechazado', variant: 'danger' },
};

const FINANCE_STATUS: Record<FinanceStatusValue, StatusMeta> = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  APROBADO: { label: 'Aprobado', variant: 'info' },
  PAGADO: { label: 'Pagado', variant: 'success' },
  RECHAZADO: { label: 'Rechazado', variant: 'danger' },
};

const USER_STATUS: Record<UserStatusValue, StatusMeta> = {
  PENDING_FIRST_LOGIN: { label: 'Pendiente primer ingreso', variant: 'warning' },
  ACTIVE: { label: 'Activo', variant: 'success' },
  SUSPENDED: { label: 'Suspendido', variant: 'danger' },
};

const REQUEST_STATUS: Record<RequestStatusValue, StatusMeta> = {
  PENDIENTE: { label: 'Pendiente', variant: 'warning' },
  APROBADA: { label: 'Aprobada', variant: 'success' },
  RECHAZADA: { label: 'Rechazada', variant: 'danger' },
};

/**
 * Mapa por dominio: cada `type` conoce su union de estados y su registro
 * `Record<Status, StatusMeta>`. Se modela con un union discriminado para que el
 * `status` quede ligado al `type` correcto en el sitio de uso (sin `any`).
 */
export type StatusBadgeProps =
  | { type: 'document'; status: DocumentStatusValue; className?: string }
  | { type: 'finance'; status: FinanceStatusValue; className?: string }
  | { type: 'user'; status: UserStatusValue; className?: string }
  | { type: 'request'; status: RequestStatusValue; className?: string };

function resolve(props: StatusBadgeProps): StatusMeta {
  switch (props.type) {
    case 'document':
      return DOCUMENT_STATUS[props.status];
    case 'finance':
      return FINANCE_STATUS[props.status];
    case 'user':
      return USER_STATUS[props.status];
    case 'request':
      return REQUEST_STATUS[props.status];
  }
}

/**
 * Chip de estado unificado, construido sobre {@link Badge}. Selecciona la
 * etiqueta legible y la variante de color según el dominio (`type`). Reemplaza a
 * los 4 `*-status-badge` por-dominio manteniendo todos los estados.
 */
export function StatusBadge(props: StatusBadgeProps): ReactNode {
  const { label, variant } = resolve(props);
  const badgeVariant = variant satisfies NonNullable<BadgeProps['variant']>;
  return (
    <Badge variant={badgeVariant} className={props.className}>
      {label}
    </Badge>
  );
}
