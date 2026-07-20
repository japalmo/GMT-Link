import type { RoleKey, UserStatus } from '@gmt-platform/contracts';

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
  // Roles de sistema Fase 1 (spec §2.3).
  trabajador: 'Trabajador',
  admin_contrato: 'Administrador de Contrato',
  admin_finanzas: 'Administrador de Finanzas',
  analista_rh: 'Analista de RH',
  analista_finanzas: 'Analista de Finanzas',
  asesor_hse: 'Asesor HSE',
  gerencia_proyectos: 'Gerencia de Proyectos',
  gerencia_rh: 'Gerencia de RH',
  gerencia_general: 'Gerencia General',
  admin_ti: 'Administrador TI',
  // Rol de sistema Conductor (flota de vehículos): reporta uso y ejecuta checklist.
  conductor: 'Conductor',
  // Legacy: etiquetas de rol de trabajador a nivel PROYECTO (no bundles de org).
  supervisor: 'Supervisor',
  operador: 'Operador',
  ito: 'Inspector Técnico (ITO)',
  adm_contrato: 'Administrador de Contrato',
};

/**
 * Devuelve la etiqueta legible de un rol, con fallback al propio key. Acepta
 * cualquier `string` porque las membresías pueden traer claves de roles
 * dinámicos (personalizados) que no están en el union `RoleKey`.
 */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role as RoleKey] ?? role;
}

/**
 * Etiquetas legibles (es-CL) por módulo del catálogo de permisos (§8). Igual que
 * {@link ROLE_LABELS}, es solo presentación: reemplaza la clave cruda (minúscula)
 * por un nombre presentable en la matriz de roles.
 */
export const MODULE_LABELS: Record<string, string> = {
  sistema: 'Sistema',
  directorio: 'Directorio',
  clientes: 'Clientes',
  proyectos: 'Proyectos',
  tareas: 'Tareas',
  documentos: 'Documentos',
  'v-metric': 'V-Metric',
  finanzas: 'Finanzas',
  activos: 'Activos',
  recursos: 'Recursos',
};

/**
 * Devuelve la etiqueta legible de un módulo, con fallback al propio valor crudo
 * si no está mapeado (mismo patrón que {@link roleLabel}).
 */
export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
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
