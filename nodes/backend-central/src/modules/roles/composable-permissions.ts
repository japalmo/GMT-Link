import type { FgaObjectType, PermissionKind } from '@gmt-platform/contracts';

/** Forma mínima de un Permission necesaria para decidir composabilidad. */
export interface ComposablePermissionInput {
  key: string;
  kind: PermissionKind;
}

/**
 * Mapa SPINE (§ diseño RBAC dinámico, Fase 2): qué permisos STRUCTURAL pueden
 * incluirse en un rol CUSTOM y sobre qué tipo de objeto FGA aplican. Un
 * permiso STRUCTURAL que NO está en este mapa (p. ej. document:sign:qa,
 * asset:*) es exclusivo de los roles del sistema (isSystem=true): el admin no
 * puede componerlo en un rol propio porque su relación FGA depende de tuplas
 * que este módulo no sabe sincronizar de forma genérica (§4.3).
 *
 * Ampliar este mapa es la ÚNICA forma de habilitar un permiso STRUCTURAL
 * nuevo para roles custom; añadirlo aquí y en el modelo FGA (`[user] or ...`)
 * son los dos lados de la misma decisión (A1: las 3 relaciones org componibles
 * también reciben asignación directa `[user]`).
 */
export const COMPOSABLE_STRUCTURAL: Readonly<Record<string, FgaObjectType>> = {
  'directory:view:extended': 'organization',
  'document:review': 'organization',
  'finance:manage': 'organization',
  'project:read': 'project',
  'project:kpi:define': 'project',
  'service:create': 'project',
  'measurement:submit': 'project',
  'measurement:read': 'project',
  'task:read': 'project',
  'task:create': 'project',
  'task:assign': 'project',
  'project:team:manage': 'project',
  // Gate propio de la gestión de activos (resuelve el acople de la review de
  // seguridad Task 1.5): `asset.can_create = can_manage_assets from project` y el
  // controller de activos gatea con can_manage_assets. service:create ya NO
  // habilita la gestión de activos.
  'asset:manage': 'project',
};

/**
 * ¿Puede `permission` incluirse en los grants de un rol CUSTOM?
 * FUNCTIONAL: siempre sí (se enforcea con filtro de datos, sin tocar FGA).
 * STRUCTURAL: solo si está en `COMPOSABLE_STRUCTURAL`.
 */
export function composable(permission: ComposablePermissionInput): boolean {
  return permission.kind === 'FUNCTIONAL' || permission.key in COMPOSABLE_STRUCTURAL;
}

/**
 * Tipo de objeto FGA sobre el que aplica `permission`, o `null` si no aplica
 * (FUNCTIONAL, o STRUCTURAL fuera del mapa composable).
 */
export function fgaObjectTypeOf(permission: ComposablePermissionInput): FgaObjectType | null {
  if (permission.kind === 'FUNCTIONAL') return null;
  return COMPOSABLE_STRUCTURAL[permission.key] ?? null;
}
