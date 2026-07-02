import { IsIn, IsString } from 'class-validator';
import type { ScopeType } from '@gmt-platform/contracts';

const ASSIGNABLE_SCOPE_TYPES: readonly ScopeType[] = ['ORGANIZATION', 'PROJECT'];

/**
 * Body de `POST /users/:id/roles` (diseño matriz RBAC, Fase 3). A diferencia
 * de `AssignRoleDto` (legacy, org-only), soporta scope PROJECT y roleKeys
 * arbitrarios (roles custom incluidos) — la validación semántica (¿el rol
 * existe? ¿el scopeType es uno de sus allowedScopeTypes?) la hace
 * `UsersService.assignRoleScoped` contra `RolesService` (Fase 2), no este DTO.
 */
export class AssignRoleScopedDto {
  @IsString()
  roleKey!: string;

  @IsIn(ASSIGNABLE_SCOPE_TYPES, {
    message: `scopeType debe ser uno de: ${ASSIGNABLE_SCOPE_TYPES.join(', ')}.`,
  })
  scopeType!: ScopeType;

  @IsString()
  scopeId!: string;
}
