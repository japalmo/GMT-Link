import { EmailKind } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Body de `POST /profile/email/verify-request` — pide el código para VERIFICAR el
 * correo YA cargado del tipo indicado (institucional o personal). Sin contraseña:
 * el OTP viaja al correo ya registrado en la cuenta, y probar su posesión es la
 * verificación misma.
 */
export class VerifyEmailRequestDto {
  @IsEnum(EmailKind, { message: 'El tipo de correo debe ser INSTITUCIONAL o PERSONAL.' })
  kind!: EmailKind;
}
