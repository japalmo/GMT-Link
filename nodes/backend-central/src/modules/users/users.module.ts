import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesModule } from '../roles/roles.module';
import { CvModule } from '../cv/cv.module';
import { OvertimeModule } from '../overtime/overtime.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { FieldWorkersService } from './field-workers.service';

/**
 * Módulo de provisión de usuarios (§1.1).
 * Consume `PrismaService` (global), `FgaService` (global, vía `FgaModule`) y
 * `StorageService` (global, vía `StorageModule`). Importa `RolesModule`
 * (Fase 2, exporta `RolesService`) para la asignación por scope (`assignRoleScoped`).
 * `PermissionsGuard` es global (APP_GUARD en AppModule), por lo que los
 * `@RequirePermission` de este controller se aplican sin registrar nada extra aquí.
 */
@Module({
  imports: [PrismaModule, RolesModule, CvModule, OvertimeModule],
  controllers: [UsersController],
  providers: [FieldWorkersService, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
