import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RoleGrantDto } from './role-grant.dto';

/**
 * Body de `POST /roles` (RBAC dinámico, Fase 2). Crea un rol CUSTOM
 * (`isSystem=false`); la clave (`key`) se deriva del label vía `slugKey`
 * (RolesService), no viene en el body. `grants: []` es VÁLIDO (A6): el flujo
 * UI "Nuevo rol" crea vacío y edita después.
 */
export class CreateRoleDto {
  @IsString()
  @MinLength(1, { message: 'El nombre del rol es obligatorio.' })
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @ArrayMaxSize(50, { message: 'Un rol admite como máximo 50 permisos.' })
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants!: RoleGrantDto[];
}
