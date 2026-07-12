import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { EmailKind } from '@prisma/client';

/**
 * Body de `POST /profile/email/change-request`. Solicita un OTP al `newEmail` para
 * verificarlo antes de aplicarlo al campo indicado por `kind` (institucional o
 * personal). Exige además la contraseña actual (reautenticación). El código NO se
 * retorna: viaja solo por correo (EmailService).
 */
export class ChangeEmailRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Debes indicar tu contraseña actual.' })
  currentPassword!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  newEmail!: string;

  @IsEnum(EmailKind, { message: 'El tipo de correo debe ser INSTITUCIONAL o PERSONAL.' })
  kind!: EmailKind;
}
