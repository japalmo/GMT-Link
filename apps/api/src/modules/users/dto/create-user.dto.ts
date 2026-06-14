import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ROLE_KEYS } from '../../../common/role-keys';
import type { RoleKey } from '../../../common/role-keys';

/**
 * Body de `POST /users` (§1.1). El admin provisiona un colaborador o cliente.
 * Validación de forma vía class-validator; la validación dura de `roleKeys`
 * contra la tabla Role la hace `UsersService` (espejo §4.1).
 * `ROLE_KEYS` es un readonly tuple; class-validator pide un array mutable de
 * valores permitidos, de ahí el spread defensivo.
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
  @ArrayMaxSize(ROLE_KEYS.length)
  @IsIn([...ROLE_KEYS], {
    each: true,
    message: `Cada rol debe ser uno de: ${ROLE_KEYS.join(', ')}.`,
  })
  roleKeys!: RoleKey[];

  @IsOptional()
  @IsBoolean()
  isClientUser?: boolean;
}
