import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body de `POST /auth/reset-password`. Cierre del flujo de recuperación para una
 * cuenta ACTIVA: usuario + código OTP (enviado por `forgot-password`) + la nueva
 * contraseña. El handler verifica el OTP contra el mismo destino que lo emitió y,
 * solo entonces, fija la nueva clave e invalida las sesiones previas.
 */
export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu usuario.' })
  @MaxLength(120, { message: 'El usuario no puede superar los 120 caracteres.' })
  username!: string;

  /** Código OTP de 6 dígitos enviado al correo. */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code!: string;

  /** Nueva contraseña. Debe tener al menos 8 caracteres. */
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(128, { message: 'La contraseña no puede superar los 128 caracteres.' })
  newPassword!: string;
}
