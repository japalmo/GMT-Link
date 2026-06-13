import { IsString, MinLength } from 'class-validator';

/**
 * Body de `POST /auth/first-login/complete`.
 * La nueva contraseña debe tener al menos 8 caracteres.
 */
export class CompleteFirstLoginDto {
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword!: string;
}
