import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReimbursementsController } from './reimbursements.controller';
import { ReimbursementsService } from './reimbursements.service';

/**
 * Módulo de reembolsos (§6-3.1, primitivas `RoleScopedList` + `RequestForm`).
 * Consume `PrismaService`, `StorageService` y `FgaService` (todos globales).
 * Importa `NotificationsModule` para avisar al solicitante en cada transición
 * (§6-2.2). El gating de gestión usa `FgaService` vía el guard + `@RequirePermission`;
 * `getById` también inyecta `FgaService` para resolver dueño-vs-gestor.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ReimbursementsController],
  providers: [ReimbursementsService],
  exports: [ReimbursementsService],
})
export class ReimbursementsModule {}
