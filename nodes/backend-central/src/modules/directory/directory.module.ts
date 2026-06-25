import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';

/**
 * Módulo de directorio (§6-1.6).
 * Consume `PrismaService` (global). El detalle extendido usa `@RequirePermission`,
 * resuelto por el `PermissionsGuard` global (APP_GUARD en AppModule) contra
 * OpenFGA — no requiere registrar nada extra aquí.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DirectoryController],
  providers: [DirectoryService],
  exports: [DirectoryService],
})
export class DirectoryModule {}
