import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Body de `POST /auth/first-login/complete`.
 *
 * Exige la contraseña provisoria/actual (`currentPassword`) además de la nueva:
 * el handler la re-verifica contra el `passwordHash` vigente antes de aceptar el
 * cambio. Así, un JWT filtrado en estado `PENDING_FIRST_LOGIN` (7d, sin
 * revocación) no basta por sí solo para tomar control de la cuenta.
 */
export class CompleteFirstLoginDto {
  /** Contraseña provisoria/actual con la que se ingresó. Se re-verifica. */
  @IsString()
  @IsNotEmpty({ message: 'Debes ingresar tu contraseña provisoria actual.' })
  currentPassword!: string;

  /** Nueva contraseña. Debe tener al menos 8 caracteres. */
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword!: string;
}
