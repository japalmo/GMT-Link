import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { PermissionRequestsController } from './permission-requests.controller';
import { PermissionRequestsService } from './permission-requests.service';

/**
 * Módulo de solicitudes de permisos a admin (§6-2.3).
 *
 * Importa:
 *  - `UsersModule` (exporta `UsersService`) → aprobar reusa `assignRole`
 *    (Membership + sync FGA verificado, decisiones §9).
 *  - `NotificationsModule` (exporta `NotificationsService`) → notifica al
 *    solicitante al resolver.
 *  - `PrismaModule` (global) → acceso a `permissionRequest`.
 *
 * Las rutas de admin las gatea el `PermissionsGuard` global (APP_GUARD) vía los
 * `@RequirePermission('can_manage_users', organization:gmt)` del controller.
 */
@Module({
  imports: [PrismaModule, UsersModule, NotificationsModule],
  controllers: [PermissionRequestsController],
  providers: [PermissionRequestsService],
})
export class PermissionRequestsModule {}
