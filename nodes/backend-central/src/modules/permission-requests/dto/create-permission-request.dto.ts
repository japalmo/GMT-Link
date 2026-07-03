import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /permission-requests`. El DTO valida solo la FORMA del
 * `roleKey` (string acotado); su EXISTENCIA la valida el service contra la
 * tabla `Role` de Postgres (roles dinámicos, incluidos `c_xxx` — 400 si no
 * está en el catálogo). El scope no se envía: el MVP fija ORGANIZATION/ORG_ID.
 */
export class CreatePermissionRequestDto {
  @IsString()
  @MaxLength(100)
  roleKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
