import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body de `POST /permission-requests`. El `roleKey` se valida como string aquí y
 * semánticamente (¿es una RoleKey conocida?) en el service con `isRoleKey`
 * (400 si es inválido). El scope no se envía: el MVP fija ORGANIZATION/ORG_ID.
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
