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
 * Body de `PATCH /roles/:key` (RBAC dinámico, Fase 2). Todos los campos son
 * opcionales (actualización parcial); si `grants` viene (aunque sea `[]`),
 * REEMPLAZA el set completo de grants del rol (no hace merge). 403 en el
 * service si el rol es `isSystem`.
 */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El nombre del rol no puede quedar vacío.' })
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Un rol admite como máximo 50 permisos.' })
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants?: RoleGrantDto[];
}
