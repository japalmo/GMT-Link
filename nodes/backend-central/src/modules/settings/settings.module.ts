import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Módulo de configuración del usuario (§6-2.3). Consume `PrismaService` (global)
 * para leer/escribir `UserPreferences`. `PermissionsGuard` es global (APP_GUARD);
 * estas rutas no llevan `@RequirePermission` (operan solo sobre lo propio, por
 * userId de sesión), así que no requieren registro extra aquí.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
