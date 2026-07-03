import type { RequestStatus } from '@prisma/client';
import type { RoleKey } from '../../common/role-keys';

/**
 * Vista pública de una solicitud de permiso/rol (§6-2.3 "solicitar permisos a
 * admin"). Fechas en ISO-8601 (string) para el front; campos de decisión null
 * mientras esté PENDIENTE.
 */
export interface PermissionRequestView {
  id: string;
  /** Solicitante (dueño de la solicitud). */
  userId: string;
  /** Rol solicitado (existencia validada contra la tabla `Role`). */
  roleKey: RoleKey;
  /** Scope de la solicitud (en el MVP siempre ORGANIZATION sobre ORG_ID). */
  scopeType: 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'SERVICE';
  scopeId: string;
  /** Motivo opcional aportado por el solicitante. */
  reason: string | null;
  status: RequestStatus;
  /** Admin que decidió; null mientras PENDIENTE. */
  decidedById: string | null;
  /** ISO-8601 de la decisión; null mientras PENDIENTE. */
  decidedAt: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/**
 * Datos mínimos del solicitante para la vista del admin (GET /permission-requests).
 * Permite pintar nombre/email sin exponer el resto del modelo User.
 */
export interface RequesterSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Solicitud + datos del solicitante (vista del admin). */
export interface PermissionRequestAdminView extends PermissionRequestView {
  requester: RequesterSummary;
}
