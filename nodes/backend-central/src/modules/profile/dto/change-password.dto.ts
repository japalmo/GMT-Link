import { IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Body de `POST /profile/change-password` (§6-1.3 "Mis datos: cambiar clave"),
 * ENDURECIDO por la feature de verificación:
 *  - `currentPassword`: se verifica con bcrypt contra el hash actual (401 si no coincide).
 *  - `newPassword`: mínimo 8 caracteres, igual que el primer login (§6-0.5).
 *  - `code`: OTP enviado por `POST /profile/password/change-request` (obligatorio).
 * Solo si contraseña actual + OTP son válidos se persiste la nueva contraseña.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes indicar tu contraseña actual.' })
  currentPassword!: string;

  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'Debes indicar el código de verificación.' })
  code!: string;
}
