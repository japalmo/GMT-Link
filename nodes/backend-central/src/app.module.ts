import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { SessionMiddleware } from './auth/session.middleware';
import { PermissionsGuard } from './authz/permissions.guard';
import { AuthzModule } from './authz/authz.module';
import { CommonModule } from './common/common.module';
import { StorageModule } from './common/storage/storage.module';
import { DevUserMiddleware } from './dev/dev-user.middleware';
import { FgaModule } from './fga/fga.module';
import { HealthController } from './health.controller';
import { CvModule } from './modules/cv/cv.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OvertimeModule } from './modules/overtime/overtime.module';
import { PermissionRequestsModule } from './modules/permission-requests/permission-requests.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ReimbursementsModule } from './modules/reimbursements/reimbursements.module';
import { RolesModule } from './modules/roles/roles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ProjectDocumentsModule } from './modules/project-documents/project-documents.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ToolsModule } from './modules/tools/tools.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ClientsModule } from './modules/clients/clients.module';
import { FaenasModule } from './modules/faenas/faenas.module';
import { ServiceTypesModule } from './modules/service-types/service-types.module';
import { SignaturesModule } from './modules/signatures/signatures.module';

@Module({
  imports: [
    // Límite global anti-abuso: 120 req/min por IP (excluye /health). El
    // errorMessage traduce el 429 del throttle al español (el lockout de cuenta
    // trae su propio mensaje con los minutos restantes).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      errorMessage: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
    }),
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    CommonModule,
    StorageModule,
    PrismaModule,
    FgaModule,
    AuthzModule,
    AuthModule,
    UsersModule,
    RolesModule,
    ProfileModule,
    DirectoryModule,
    CvModule,
    DocumentsModule,
    NotificationsModule,
    DashboardModule,
    SettingsModule,
    PermissionRequestsModule,
    ReimbursementsModule,
    OvertimeModule,
    ProjectsModule,
    ServiceTypesModule,
    TasksModule,
    ProjectDocumentsModule,
    AssetsModule,
    ToolsModule,
    GamificationModule,
    MetricsModule,
    ClientsModule,
    FaenasModule,
    SignaturesModule,
  ],
  controllers: [HealthController],
  providers: [
    // El orden de este array = orden de ejecución de los guards globales en NestJS.
    // ThrottlerGuard va PRIMERO para descartar floods antes de resolver permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' = comodín "todas las rutas" en path-to-regexp v8 (Express 5 / Nest 11),
    // equivalente moderno del legacy '*'.
    // Orden: SessionMiddleware (sesión real, JWT propio) PRIMERO; DevUserMiddleware
    // DESPUÉS, como fallback solo-dev que no pisa una sesión real ya resuelta.
    consumer.apply(SessionMiddleware, DevUserMiddleware).forRoutes('{*path}');
  }
}
