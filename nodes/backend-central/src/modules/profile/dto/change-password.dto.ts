import { IsString, MinLength } from 'class-validator';

/**
 * Body de `POST /profile/change-password` (§6-1.3 "Mis datos: cambiar clave").
 * Cambia la contraseña del PROPIO usuario (bcrypt → passwordHash, vía el
 * userId de la sesión). Mínimo 8 caracteres, igual que el primer login (§6-0.5).
 */
export class ChangePasswordDto {
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  newPassword!: string;
}
