import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Módulo de documentos personales (§6-1.5 "Mis documentos").
 * Consume `PrismaService` (global) y `StorageService` (global, StorageModule).
 * El gating de revisión usa `FgaService` (global) vía el guard + `@RequirePermission`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
