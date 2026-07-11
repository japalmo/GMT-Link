import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OvertimeController } from './overtime.controller';
import { OvertimeService } from './overtime.service';

/**
 * Módulo de horas extra (spec §5.6). Consume `PrismaService` y `PermissionService`
 * (gating por permiso funcional), ambos globales. Importa `NotificationsModule`
 * para avisar al solicitante en cada transición.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OvertimeController],
  providers: [OvertimeService],
  exports: [OvertimeService],
})
export class OvertimeModule {}
