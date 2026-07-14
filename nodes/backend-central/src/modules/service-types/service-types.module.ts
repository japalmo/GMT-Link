import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ServiceTypesController } from './service-types.controller';
import { ServiceTypesService } from './service-types.service';

/**
 * Módulo del catálogo de tipos de servicio (Tanda 4). Consume `PrismaService`
 * (global) y `PermissionService` (global, para el gate `service_type:manage`).
 * Exporta el service por si el módulo de proyectos lo necesita a futuro (hoy
 * `createService` resuelve el tipo directo por Prisma).
 */
@Module({
  imports: [PrismaModule],
  controllers: [ServiceTypesController],
  providers: [ServiceTypesService],
  exports: [ServiceTypesService],
})
export class ServiceTypesModule {}
