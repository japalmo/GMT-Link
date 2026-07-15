import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Módulo Inventario: catálogo de artículos (Supply ampliado), import masivo por
 * CSV, proveedores por artículo y solicitudes de insumos con entrega que
 * descuenta stock. `PermissionService` llega vía `AuthzModule` (global).
 */
@Module({
  imports: [PrismaModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
