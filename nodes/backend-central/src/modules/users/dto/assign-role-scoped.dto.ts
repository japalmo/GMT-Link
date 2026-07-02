import { IsIn, IsOptional, IsString } from 'class-validator';
import type { ScopeType } from '@gmt-platform/contracts';

const ASSIGNABLE_SCOPE_TYPES: readonly ScopeType[] = ['ORGANIZATION', 'PROJECT'];

/**
 * Body de `POST /users/:id/roles` (diseño matriz RBAC, Fase 3). A diferencia
 * de `AssignRoleDto` (legacy, org-only), soporta scope PROJECT y roleKeys
 * arbitrarios (roles custom incluidos) — la validación semántica (¿el rol
 * existe? ¿el scopeType es uno de sus allowedScopeTypes?) la hace
 * `UsersService.assignRoleScoped` contra `RolesService` (Fase 2), no este DTO.
 *
 * Retro-compat: `scopeType`/`scopeId` son OPCIONALES. Cuando faltan, el
 * controller los completa con ORGANIZATION/ORG_ID, de modo que el body legacy
 * `{ roleKey }` (que sigue enviando `roles-dialog.tsx` hasta la Fase 5) asigna
 * el rol org-scope como antes. El body nuevo con scope explícito también corre.
 */
export class AssignRoleScopedDto {
  @IsString()
  roleKey!: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_SCOPE_TYPES, {
    message: `scopeType debe ser uno de: ${ASSIGNABLE_SCOPE_TYPES.join(', ')}.`,
  })
  scopeType?: ScopeType;

  @IsOptional()
  @IsString()
  scopeId?: string;
}
