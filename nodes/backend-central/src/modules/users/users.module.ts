import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesModule } from '../roles/roles.module';
import { CvModule } from '../cv/cv.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Módulo de provisión de usuarios (§1.1).
 * Consume `PrismaService` (global), `FgaService` (global, vía `FgaModule`) y
 * `StorageService` (global, vía `StorageModule`). Importa `RolesModule`
 * (Fase 2, exporta `RolesService`) para la asignación por scope (`assignRoleScoped`).
 * `PermissionsGuard` es global (APP_GUARD en AppModule), por lo que los
 * `@RequirePermission` de este controller se aplican sin registrar nada extra aquí.
 */
@Module({
  imports: [PrismaModule, RolesModule, CvModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
