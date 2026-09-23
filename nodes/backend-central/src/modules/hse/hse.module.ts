import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthzModule } from '../../authz/authz.module';
import { StorageModule } from '../../common/storage/storage.module';
import { HseController } from './hse.controller';
import { HseService } from './hse.service';
import { HsePdfScheduler } from './hse-pdf.scheduler';

/**
 * HSE. Hoy resuelve una sola cosa: el reporte de incidente, desde el formulario
 * público de terreno hasta el historial que consulta la sección.
 *
 * El gate se resuelve con `PermissionService` inline porque el mismo controlador
 * tiene rutas públicas (sin sesión) y rutas con permiso; un guard a nivel de
 * clase obligaría a partirlo en dos.
 */
@Module({
  imports: [PrismaModule, AuthzModule, StorageModule],
  controllers: [HseController],
  providers: [HseService, HsePdfScheduler],
  exports: [HseService],
})
export class HseModule {}
