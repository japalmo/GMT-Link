import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GamificationModule } from '../gamification/gamification.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Módulo de documentos personales (§6-1.5 "Mis documentos").
 * Consume `PrismaService` (global) y `StorageService` (global, StorageModule).
 * El gating de revisión usa `FgaService` (global) vía el guard + `@RequirePermission`.
 * Importa `NotificationsModule` para notificar al dueño al aprobar/rechazar (§6-2.2).
 */
@Module({
  imports: [PrismaModule, NotificationsModule, GamificationModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
