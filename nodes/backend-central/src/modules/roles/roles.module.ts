import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Módulo de CRUD de roles dinámicos (RBAC dinámico, Fase 2).
 * Consume `PrismaService` (global) y `FgaService` (global, vía `FgaModule`).
 * `PermissionsGuard` es global (APP_GUARD en AppModule), por lo que los
 * `@RequirePermission` de `RolesController` se aplican sin registrar nada
 * extra aquí (mismo patrón que `UsersModule`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
