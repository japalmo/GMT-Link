import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Recorta espacios de un valor string (deja intactos los no-string). */
const trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Body de `PATCH /profile/me` (§6-1.3 "Mis datos: editar").
 *
 * Todos los campos son OPCIONALES (PATCH parcial). Reglas:
 *  - `firstName`/`lastName`: si vienen, no pueden ser vacíos (MinLength 1) —
 *    el plan maestro los modela como obligatorios en el User (§4.2), así que un
 *    PATCH no puede dejarlos en blanco.
 *  - `secondName`/`secondLastName`: opcionales; se permite el string vacío para
 *    "limpiarlos" (el service lo normaliza a null).
 *  - `avatarUrl`: URL válida o string vacío (limpiar el avatar). `@IsUrl` se
 *    salta cuando el valor es '' vía `@ValidateIf`.
 *
 * NO incluye email (identidad → solo lectura), ni status, roles o
 * points: esos no son editables desde el perfil propio (§6-1.3).
 */
export class UpdateProfileDto {
  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1, { message: 'El nombre no puede estar vacío.' })
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  secondName?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MinLength(1, { message: 'El apellido no puede estar vacío.' })
  @MaxLength(80)
  lastName?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  secondLastName?: string;

  @IsOptional()
  @trim()
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ require_protocol: true }, { message: 'El avatar debe ser una URL válida.' })
  @MaxLength(2048)
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cargo?: string | null;
}
