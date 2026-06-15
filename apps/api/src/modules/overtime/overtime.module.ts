import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OvertimeController } from './overtime.controller';
import { OvertimeService } from './overtime.service';

/**
 * Módulo de horas extra (§6-3.3, mismo patrón que reembolsos — sin storage).
 * Consume `PrismaService` y `FgaService` (globales). Importa `NotificationsModule`
 * para avisar al solicitante en cada transición (§6-2.2). El gating de gestión
 * usa `FgaService` vía el guard + `@RequirePermission`; `getById` también inyecta
 * `FgaService` para resolver dueño-vs-gestor.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OvertimeController],
  providers: [OvertimeService],
  exports: [OvertimeService],
})
export class OvertimeModule {}
