import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { THEME_VALUES } from '../settings.types';
import type { ThemePreference } from '../settings.types';

/**
 * Body de `PATCH /settings/me`. Todos los campos son opcionales (patch parcial):
 * solo se actualizan los enviados. `theme` se restringe a la lista válida con
 * `@IsIn`. El `ValidationPipe` (whitelist + forbidNonWhitelisted) rechaza extras.
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
}
