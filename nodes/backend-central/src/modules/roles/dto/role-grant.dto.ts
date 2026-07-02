import { IsIn, IsString, MinLength } from 'class-validator';
import type { PermissionScopeValue } from '@gmt-platform/contracts';

const SCOPE_VALUES: readonly PermissionScopeValue[] = ['OWN', 'PROJECT', 'GLOBAL'];

/**
 * Un grant dentro del body de crear/editar rol (§ diseño RBAC dinámico Fase 2).
 * La validación SEMÁNTICA (¿el permiso existe? ¿es composable? ¿scope
 * permitido para ese permiso? ¿scope homogéneo entre grants STRUCTURAL?) la
 * hace `RolesService.validateGrants`; aquí solo se valida la FORMA.
 */
export class RoleGrantDto {
  @IsString()
  @MinLength(1, { message: 'El permiso del grant es obligatorio.' })
  permissionKey!: string;

  @IsIn(SCOPE_VALUES, { message: `El scope debe ser uno de: ${SCOPE_VALUES.join(', ')}.` })
  scope!: PermissionScopeValue;
}
