/**
 * Estado de la cuenta de un usuario, espejo de `UserStatus` en Postgres (§4.2).
 * - PENDING_FIRST_LOGIN: debe fijar su contraseña antes de operar.
 * - ACTIVE: cuenta operativa.
 * - SUSPENDED: acceso bloqueado por un admin.
 */
export type UserStatus = 'PENDING_FIRST_LOGIN' | 'ACTIVE' | 'SUSPENDED';

/**
 * Usuario autenticado tal como lo devuelve `GET /auth/me`. Es la vista pública
 * del `User` de Postgres: nunca incluye campos internos. El `status` decide el
 * enrutamiento (primer login forzado vs. acceso normal).
 */
export interface AuthedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
}
