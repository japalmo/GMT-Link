/**
 * Tipos del frontend para Configuración (§6-2.3). Reflejan el contrato HTTP de
 * la API: ajustes propios (`/settings/me`) y solicitudes de acceso a roles
 * (`/permission-requests`). Las fechas viajan como string ISO-8601.
 */

import type { RoleKey, ScopeType } from '@gtm-link/shared-types';

/** Preferencia de tema del usuario. `system` sigue al sistema operativo. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Ajustes propios del usuario (`GET/PATCH /settings/me`). Defaults perezosos. */
export interface UserSettings {
  theme: ThemePreference;
  /** Recibir notificaciones dentro de la app. */
  notifyInApp: boolean;
  /** Recibir notificaciones por correo (aún no envía correos, decisión §9). */
  notifyEmail: boolean;
}

/** Cambios parciales a los ajustes propios (`PATCH /settings/me`). */
export interface UpdateSettingsInput {
  theme?: ThemePreference;
  notifyInApp?: boolean;
  notifyEmail?: boolean;
}

/** Estado de una solicitud de acceso a un rol. */
export type PermissionRequestStatus = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

/** Vista de una solicitud de acceso propia del usuario. */
export interface PermissionRequestView {
  id: string;
  roleKey: RoleKey;
  scopeType: ScopeType;
  scopeId: string;
  /** Motivo opcional que escribió quien solicita; null si no lo dio. */
  reason: string | null;
  status: PermissionRequestStatus;
  /** ISO-8601 cuando se aprobó/rechazó; null mientras esté pendiente. */
  decidedAt: string | null;
  createdAt: string;
}

/**
 * Vista de una solicitud pendiente para el administrador: la solicitud más los
 * datos de quien la pide. Solo se sirve a administradores.
 */
export interface PermissionRequestAdminView extends PermissionRequestView {
  requester: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}
