import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Body de `POST /profile/email/change-confirm`. Confirma el cambio de correo
 * pendiente (`pendingEmail`) con el OTP recibido por correo. Al validar, el correo
 * se aplica al campo correspondiente y se marca como verificado.
 */
export class ChangeEmailConfirmDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes indicar el código de verificación.' })
  code!: string;
}
