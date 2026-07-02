/**
 * @gmt-platform/contracts — tipos compartidos del monorepo.
 * Los tipos de dominio se agregan por etapa según el plan maestro (§4.2).
 */

/** Respuesta del endpoint GET /health de nodes/backend-central. Valida el wiring del workspace en 0.1. */
export interface HealthResponse {
  status: 'ok';
  service: 'gmt-link-api';
  timestamp: string;
}

/** Scopes de membresía (§4.2 — enum ScopeType). */
export type ScopeType = 'ORGANIZATION' | 'DEPARTMENT' | 'PROJECT' | 'SERVICE';

/**
 * Claves de rol válidas (semilla §6-0.2 / §4.3). Son los bundles asignables.
 * La fuente de verdad de autorización es OpenFGA; esta lista es el contrato
 * compartido back↔front para validar y pintar selects de roles.
 */
export const ROLE_KEYS = [
  'org_admin',
  'department_admin',
  'project_creator',
  'operator',
  'qa',
  'finance',
  'viewer',
  'client_ito',
  'supervisor',
  'operador',
  'ito',
  'adm_contrato',
] as const;

/**
 * Clave de rol. Antes unión cerrada sobre `ROLE_KEYS`; con roles dinámicos
 * (§7 design doc RBAC) cualquier string es válido (incluye roles personalizados
 * `c_xxx`). La validación dura contra la tabla `Role` la hace el backend
 * (`UsersService.validateRoleKeys` / `RolesService`), no el tipo.
 */
export type RoleKey = string;

/** Estados de usuario (§4.2 — enum UserStatus). */
export type UserStatus = 'PENDING_FIRST_LOGIN' | 'ACTIVE' | 'SUSPENDED';

/** Vista pública de un usuario provisionado (respuesta de creación, §1.1). */
export interface ProvisionedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roleKeys: RoleKey[];
}

/**
 * Perfil propio del usuario autenticado (§6-1.3 "Mis datos").
 * El `email` es la identidad Firebase → SOLO LECTURA. `roleKeys` viene de las
 * Membership ORGANIZATION del propio usuario. Los campos editables son
 * firstName/secondName/lastName/secondLastName/avatarUrl (ver UpdateProfileInput).
 */
export interface ProfileMe {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  avatarUrl: string | null;
  status: UserStatus;
  isClientUser: boolean;
  roleKeys: RoleKey[];
}

/** Campos editables del perfil propio (§6-1.3). Todos opcionales; email NO editable. */
export interface UpdateProfileInput {
  firstName?: string;
  secondName?: string;
  lastName?: string;
  secondLastName?: string;
  avatarUrl?: string;
}

/** Respuesta de POST /profile/change-password. */
export interface ChangePasswordResponse {
  ok: true;
}

/**
 * Item del directorio (§6-1.6). Campos BÁSICOS visibles para cualquier usuario
 * autenticado. Sin datos internos (status/points): esos van en el detalle
 * extendido y solo si el solicitante tiene el permiso directory:view:extended.
 */
export interface DirectoryEntry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  roleKeys: RoleKey[];
  isClientUser: boolean;
  companyName?: string | null;
}

/**
 * Detalle extendido del directorio (§6-1.6). Básicos + campos internos.
 * Solo se sirve a quien tiene directory:view:extended (organization#can_view_directory_extended).
 */
export interface DirectoryEntryExtended extends DirectoryEntry {
  status: UserStatus;
  points: number;
  secondName: string | null;
  secondLastName: string | null;
}

// ============ RBAC dinámico — contrato de scope (Módulo 4, ADR-0001) ============

/**
 * Filtro de fila que la fachada `PermissionService` resuelve por permiso y que el
 * backend aplica SERVER-SIDE (nunca confía en el body del cliente):
 *  - `none`     → GLOBAL: sin restricción de fila.
 *  - `own`      → OWN: WHERE createdById = userId.
 *  - `projects` → PROJECT: WHERE projectId IN (ids del usuario).
 */
export type ScopeFilter =
  | { kind: 'none' }
  | { kind: 'own' }
  | { kind: 'projects'; ids: string[] };

/** Decisión de autorización para un recurso individual. */
export interface PermissionDecision {
  effect: 'allow' | 'deny';
  filter: ScopeFilter;
}

/** Referencia mínima de un recurso para decidir un permiso de 1 instancia. */
export interface ResourceRef {
  projectId?: string;
  createdById?: string;
}

/** Alcance de un permiso dentro de un rol (espejo del enum Prisma `PermissionScope`). */
export type PermissionScopeValue = 'OWN' | 'PROJECT' | 'GLOBAL';

// ============ Roles dinámicos — matriz RBAC (design doc 2026-07-01) ============

/** Naturaleza de un permiso del catálogo (§8): resuelto en Postgres o en OpenFGA. */
export type PermissionKind = 'FUNCTIONAL' | 'STRUCTURAL';

/** Tipo de objeto FGA sobre el que se materializa un permiso STRUCTURAL componible. */
export type FgaObjectType = 'organization' | 'project';

/** Item del catálogo de permisos servido por `GET /permissions`. */
export interface PermissionCatalogItem {
  key: string;
  label: string;
  module: string;
  kind: PermissionKind;
  scopeable: boolean;
  fgaObjectType: FgaObjectType | null;
  composable: boolean;
}

/** Catálogo de permisos agrupado por módulo (orden: alfabético por `module`). */
export interface PermissionCatalogGroup {
  module: string;
  items: PermissionCatalogItem[];
}

/** Un grant dentro de un rol: permiso + alcance de resolución FUNCTIONAL. */
export interface RoleGrant {
  permissionKey: string;
  scope: PermissionScopeValue;
}

/** Detalle completo de un rol (sistema o personalizado). */
export interface RoleDetail {
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  allowedScopeTypes: ScopeType[];
  grants: RoleGrant[];
}

/** Body de `POST /roles`. */
export interface CreateRoleInput {
  label: string;
  description?: string;
  grants: RoleGrant[];
}

/** Body de `PATCH /roles/:key`. */
export interface UpdateRoleInput {
  label?: string;
  description?: string;
  grants?: RoleGrant[];
}

/** Body de `POST /users/:id/roles` (asignación por scope). */
export interface AssignRoleInput {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * Membership de un usuario (rol + scope), A4. Lo consumen las respuestas de
 * asignación (`UserRolesResponse` extendida) y `UserListItem` — esos dos tipos
 * viven en el backend (`users.types.ts`) y en `nodes/web/src/lib/api.ts`; se
 * extienden con `memberships: UserMembership[]` en Fase 3 (backend) y Fase 5 (web).
 */
export interface UserMembership {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * Respuesta de `POST /roles/:key/clone` (A7): el rol clonado + las claves de
 * permisos omitidos por NO ser componibles (así clonar roles del sistema
 * funciona y la UI puede avisar qué quedó afuera, spec §6.2/§13.4).
 */
export interface CloneRoleResponse {
  role: RoleDetail;
  omittedPermissionKeys: string[];
}
