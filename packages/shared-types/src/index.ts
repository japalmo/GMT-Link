/**
 * @gmt-link/shared-types — tipos compartidos del monorepo.
 * Los tipos de dominio se agregan por etapa según el plan maestro (§4.2).
 */

/** Respuesta del endpoint GET /health de apps/api. Valida el wiring del workspace en 0.1. */
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

/** Unión de claves de rol válidas. */
export type RoleKey = (typeof ROLE_KEYS)[number];

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
