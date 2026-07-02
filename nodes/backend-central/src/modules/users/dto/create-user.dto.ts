import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RoleKey } from '../../../common/role-keys';

/** Tope defensivo de roles por usuario en un solo request (no ligado a ROLE_KEYS). */
const MAX_ROLE_KEYS_PER_REQUEST = 20;

/**
 * Body de `POST /users` (§1.1). El admin provisiona un colaborador o cliente.
 * Validación de forma vía class-validator (solo exige texto no vacío); la
 * validación dura de `roleKeys` contra la tabla `Role` la hace `UsersService`
 * (§4.1, matriz RBAC dinámica §7 — acepta roles personalizados `c_xxx`).
 */
export class CreateUserDto {
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondName?: string;

  @IsString()
  @MinLength(1, { message: 'El apellido es obligatorio.' })
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondLastName?: string;

  @IsEmail({}, { message: 'El correo no es válido.' })
  email!: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Debe asignar al menos un rol.' })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROLE_KEYS_PER_REQUEST)
  @IsString({ each: true, message: 'Cada rol debe ser un texto no vacío.' })
  @MinLength(1, { each: true, message: 'Cada rol debe ser un texto no vacío.' })
  roleKeys!: RoleKey[];

  @IsOptional()
  @IsBoolean()
  isClientUser?: boolean;
}
