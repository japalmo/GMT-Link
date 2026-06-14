/**
 * @gtm-link/shared-types — tipos compartidos del monorepo.
 * Los tipos de dominio se agregan por etapa según el plan maestro (§4.2).
 */

/** Respuesta del endpoint GET /health de apps/api. Valida el wiring del workspace en 0.1. */
export interface HealthResponse {
  status: 'ok';
  service: 'gtm-link-api';
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
