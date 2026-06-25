import { IsIn, IsString } from 'class-validator';
import { ROLE_KEYS } from '../../../common/role-keys';
import type { RoleKey } from '../../../common/role-keys';

/**
 * Body de `POST /users/:id/roles` (§1.1). Asigna un rol org-scope a un usuario.
 * El borrado usa el roleKey por path param (`DELETE /users/:id/roles/:roleKey`),
 * por lo que no necesita DTO de body.
 */
export class AssignRoleDto {
  @IsString()
  @IsIn([...ROLE_KEYS], {
    message: `El rol debe ser uno de: ${ROLE_KEYS.join(', ')}.`,
  })
  roleKey!: RoleKey;
}
