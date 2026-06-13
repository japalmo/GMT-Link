import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Módulo global de acceso a datos. Expone `PrismaService` a todo el grafo de
 * inyección sin necesidad de re-importarlo en cada módulo de negocio.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
