/**
 * Re-export del contrato de claves de rol compartido (§4.3 / §6-0.2).
 * Vive en `@gtm-link/shared-types` para que back y front compartan la misma
 * lista; aquí se re-exporta y se añade un helper de validación de runtime.
 * La validación dura (¿existe el rol en la tabla Role?) la hace UsersService
 * contra Postgres; este helper es la primera barrera de tipo/forma.
 */
import { ROLE_KEYS } from '@gtm-link/shared-types';
import type { RoleKey } from '@gtm-link/shared-types';

export { ROLE_KEYS };
export type { RoleKey };

/** Set para lookups O(1). */
const ROLE_KEY_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

/** Type guard: ¿`value` es una RoleKey conocida? */
export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && ROLE_KEY_SET.has(value);
}
