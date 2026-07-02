/**
 * `isRoleKey` ya NO es una barrera de validación de entrada (§7 design doc RBAC):
 * con `RoleKey = string` cualquier string es una RoleKey válida por TIPO. Este
 * helper ahora es un filtro semántico ("¿es uno de los roles SEMBRADOS?") usado
 * solo para UI defensiva (directory/profile), nunca para rechazar `roleKeys`
 * entrantes — esa validación es responsabilidad de `UsersService.validateRoleKeys`
 * contra la tabla `Role` (Task 1.3).
 */
import { describe, expect, it } from 'vitest';
import { isRoleKey, ROLE_KEYS } from '../../src/common/role-keys';

describe('isRoleKey — filtro de roles sembrados (no validación de entrada)', () => {
  it('true para un rol sembrado', () => {
    expect(isRoleKey('org_admin')).toBe(true);
  });

  it('false para un rol personalizado (c_xxx) aunque sea una RoleKey válida por tipo', () => {
    expect(isRoleKey('c_inspector_de_campo')).toBe(false);
  });

  it('false para valores no-string', () => {
    expect(isRoleKey(42)).toBe(false);
    expect(isRoleKey(null)).toBe(false);
  });

  it('ROLE_KEYS sigue exportando la lista de roles del sistema', () => {
    expect(ROLE_KEYS.length).toBeGreaterThan(0);
  });
});
