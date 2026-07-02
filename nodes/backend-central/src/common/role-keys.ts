/**
 * Re-export del contrato de claves de rol compartido (§4.3 / §6-0.2).
 * Vive en `@gmt-platform/contracts` para que back y front compartan la misma
 * lista; aquí se re-exporta y se añade un helper de filtro de runtime.
 *
 * IMPORTANTE (matriz RBAC dinámica, design doc 2026-07-01 §7): desde que
 * `RoleKey` es `string` (unión abierta), `isRoleKey()` YA NO es una barrera de
 * validación de entrada — cualquier string es una `RoleKey` válida por tipo,
 * incluidos roles personalizados (`c_xxx`). Este helper solo sirve para
 * filtrar "¿es uno de los roles SEMBRADOS (ROLE_KEYS)?", útil en UI defensiva
 * (`directory.service.ts`, `profile.service.ts` listan roles conocidos).
 * La validación dura de `roleKeys` entrantes (¿existe en la tabla `Role`?) es
 * responsabilidad exclusiva de `UsersService.validateRoleKeys` / `RolesService`
 * contra Postgres — NO usar `isRoleKey` para esa validación.
 */
import { ROLE_KEYS } from '@gmt-platform/contracts';
import type { RoleKey } from '@gmt-platform/contracts';

export { ROLE_KEYS };
export type { RoleKey };

/** Set para lookups O(1) sobre los roles SEMBRADOS (no el universo de RoleKey). */
const ROLE_KEY_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

/** ¿`value` es uno de los roles SEMBRADOS conocidos (ROLE_KEYS)? NO es un validador de entrada. */
export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && ROLE_KEY_SET.has(value);
}
