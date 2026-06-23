import type { RoleKey, UserStatus } from '@gmt-link/shared-types';

/**
 * Etiquetas legibles (es-CL) para cada {@link RoleKey}. Estas claves son los
 * bundles asignables (§4.3); a nivel organización funcionan como "rol por
 * defecto" del usuario (decisión §9 1.1). La fuente de verdad de autorización
 * sigue siendo OpenFGA — este mapa es solo presentación.
 */
export const ROLE_LABELS: Record<RoleKey, string> = {
  org_admin: 'Administrador de organización',
  department_admin: 'Administrador de departamento',
  project_creator: 'Creador de proyectos',
  operator: 'Operador',
  qa: 'Control de calidad (QA)',
  finance: 'Finanzas',
  viewer: 'Visor',
  client_ito: 'Cliente ITO',
  supervisor: 'Supervisor',
  operador: 'Operador',
  ito: 'Inspector Técnico (ITO)',
  adm_contrato: 'Administrador de Contrato',
};

/** Devuelve la etiqueta legible de un rol, con fallback al propio key. */
export function roleLabel(role: RoleKey): string {
  return ROLE_LABELS[role] ?? role;
}

/** Etiquetas legibles (es-CL) para cada {@link UserStatus}. */
export const STATUS_LABELS: Record<UserStatus, string> = {
  PENDING_FIRST_LOGIN: 'Pendiente primer ingreso',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
};

/** Devuelve la etiqueta legible de un estado de usuario. */
export function statusLabel(status: UserStatus): string {
  return STATUS_LABELS[status] ?? status;
}
