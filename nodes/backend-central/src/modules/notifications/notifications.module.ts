import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Módulo de notificaciones in-app (§6-2.2). Consume `PrismaService` (global).
 * Exporta `NotificationsService` para que otros módulos (p. ej. Documents)
 * puedan crear notificaciones al disparar eventos de negocio.
 */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
