import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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
import { SettingsModule } from './modules/settings/settings.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';
import { LiquidationsModule } from './modules/liquidations/liquidations.module';

import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ProjectDocumentsModule } from './modules/project-documents/project-documents.module';
import { AssetsModule } from './modules/assets/assets.module';
import { SuppliesModule } from './modules/supplies/supplies.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { ToolsModule } from './modules/tools/tools.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { MetricsModule } from './modules/metrics/metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    CommonModule,
    StorageModule,
    PrismaModule,
    FgaModule,
    AuthzModule,
    AuthModule,
    UsersModule,
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
    LiquidationsModule,
    ProjectsModule,
    TasksModule,
    ProjectDocumentsModule,
    AssetsModule,
    SuppliesModule,
    ProvidersModule,
    ToolsModule,
    GamificationModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: PermissionsGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' = comodín "todas las rutas" en path-to-regexp v8 (Express 5 / Nest 11),
    // equivalente moderno del legacy '*'.
    // Orden: SessionMiddleware (sesión real Firebase) PRIMERO; DevUserMiddleware
    // DESPUÉS, como fallback solo-dev que no pisa una sesión real ya resuelta.
    consumer.apply(SessionMiddleware, DevUserMiddleware).forRoutes('{*path}');
  }
}
