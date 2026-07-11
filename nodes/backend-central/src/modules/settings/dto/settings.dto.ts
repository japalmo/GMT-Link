import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { THEME_VALUES } from '../settings.types';
import type { NotifyEmailTarget, ThemePreference } from '../settings.types';

/** Valores válidos de `notifyEmailTarget` (espejo del enum Prisma `EmailKind`). */
const NOTIFY_EMAIL_TARGET_VALUES = ['INSTITUCIONAL', 'PERSONAL'] as const;

/**
 * Body de `PATCH /settings/me`. Todos los campos son opcionales (patch parcial):
 * solo se actualizan los enviados. `theme` se restringe a la lista válida con
 * `@IsIn`. El `ValidationPipe` (whitelist + forbidNonWhitelisted) rechaza extras.
 *
 * `notifyEmailTarget` valida el FORMATO aquí ('INSTITUCIONAL' | 'PERSONAL'); que
 * apunte a un correo VERIFICADO lo valida el service (necesita la BD).
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsIn(THEME_VALUES)
  theme?: ThemePreference;

  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  @IsOptional()
  @IsIn(NOTIFY_EMAIL_TARGET_VALUES)
  notifyEmailTarget?: NotifyEmailTarget;
}
