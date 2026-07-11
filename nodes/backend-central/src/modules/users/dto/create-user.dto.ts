import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RoleKey } from '../../../common/role-keys';
import { AtLeastOneEmail } from './at-least-one-email.validator';

/** Tope defensivo de roles por usuario en un solo request (no ligado a ROLE_KEYS). */
const MAX_ROLE_KEYS_PER_REQUEST = 20;

/** username: 3-30 chars, minúsculas/dígitos/punto/guion/guion bajo (default = prefijo del email institucional). */
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/**
 * Body de `POST /users` (§1.1, §4.3). El admin provisiona un colaborador o cliente.
 * Identidad de login = `username` (único). Debe traer ≥1 email (institucional/personal); el `email`
 * legacy lo deriva `UsersService` (D1). Validación dura de `roleKeys` contra `Role` la hace el service.
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

  @IsString()
  @Matches(USERNAME_RE, {
    message: 'El usuario debe tener 3-30 caracteres: minúsculas, dígitos, punto, guion o guion bajo.',
  })
  @AtLeastOneEmail()
  username!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email institucional no es válido.' })
  emailInstitucional?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email personal no es válido.' })
  emailPersonal?: string;

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
