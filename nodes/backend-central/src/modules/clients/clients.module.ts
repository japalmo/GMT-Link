import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

/**
 * Módulo de clientes. `PermissionService` se inyecta desde el módulo global
 * de autorización (AuthzModule), por lo que no se importa aquí explícitamente.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
