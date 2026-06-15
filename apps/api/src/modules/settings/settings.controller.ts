import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { UpdateSettingsDto } from './dto/settings.dto';
import { SettingsService } from './settings.service';
import type { UserPreferencesView } from './settings.types';

/**
 * Configuración del usuario (§6-2.3). Rutas AUTENTICADAS que operan SOLO sobre
 * las preferencias del propio usuario: el `userId` se deriva de la sesión, nunca
 * del body. El `ValidationPipe` (whitelist + forbidNonWhitelisted) rechaza
 * campos extra y `theme` fuera de la lista válida.
 */
@Controller('settings')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** Preferencias propias (crea defaults lazy si no existen). */
  @Get('me')
  getMine(@CurrentUser() authUser: AuthUser | undefined): Promise<UserPreferencesView> {
    return this.settingsService.getMine(this.requireUserId(authUser));
  }

  /** Aplica un patch parcial de preferencias propias (upsert). Retorna el resultado. */
  @Patch('me')
  updateMine(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: UpdateSettingsDto,
  ): Promise<UserPreferencesView> {
    return this.settingsService.updateMine(this.requireUserId(authUser), dto);
  }

  /** Exige sesión: devuelve el id del usuario autenticado o lanza 401. */
  private requireUserId(authUser: AuthUser | undefined): string {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return authUser.id;
  }
}
