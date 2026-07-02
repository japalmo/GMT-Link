import { IsString, MinLength } from 'class-validator';
import type { RoleKey } from '../../../common/role-keys';

/**
 * Body de `POST /users/:id/roles` (§1.1). Asigna un rol org-scope a un usuario.
 * El borrado usa el roleKey por path param (`DELETE /users/:id/roles/:roleKey`),
 * por lo que no necesita DTO de body. Validación de forma vía class-validator
 * (texto no vacío); la validación dura contra la tabla `Role` la hace
 * `UsersService` (§4.1, matriz RBAC dinámica §7 — acepta roles personalizados).
 */
export class AssignRoleDto {
  @IsString()
  @MinLength(1, { message: 'El rol es obligatorio.' })
  roleKey!: RoleKey;
}
