import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReimbursementsController } from './reimbursements.controller';
import { ReimbursementsService } from './reimbursements.service';

/**
 * Módulo de reembolsos (spec §5). Consume `PrismaService`, `StorageService`,
 * `ConfigService` (OCR) y `PermissionService` (gating por permiso funcional) —
 * todos globales. Importa `NotificationsModule` para avisar al solicitante.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ReimbursementsController],
  providers: [ReimbursementsService],
  exports: [ReimbursementsService],
})
export class ReimbursementsModule {}
