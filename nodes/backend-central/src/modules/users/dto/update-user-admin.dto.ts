import { IsBoolean, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** username: 3-30 chars, minúsculas/dígitos/punto/guion/guion bajo (mismo patrón que la creación). */
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/**
 * Body de `PATCH /users/:id` — edición por un administrador del detalle de un
 * usuario. Todos los campos son opcionales: se aplican solo los presentes
 * (patch parcial). Los emails aceptan `null` para limpiarlos; el `email` legacy
 * lo re-deriva el service. No incluye clave, estado ni roles (flujos aparte).
 */
export class UpdateUserAdminDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El nombre no puede quedar vacío.' })
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondName?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El apellido no puede quedar vacío.' })
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondLastName?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'El email institucional no es válido.' })
  emailInstitucional?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'El email personal no es válido.' })
  emailPersonal?: string | null;

  @IsOptional()
  @IsString()
  @Matches(USERNAME_RE, {
    message: 'El usuario debe tener 3-30 caracteres: minúsculas, dígitos, punto, guion o guion bajo.',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargo?: string | null;

  @IsOptional()
  @IsBoolean()
  isClientUser?: boolean;
}
