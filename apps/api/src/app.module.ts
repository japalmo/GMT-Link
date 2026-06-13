import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { SessionMiddleware } from './auth/session.middleware';
import { PermissionsGuard } from './authz/permissions.guard';
import { DemoController } from './demo/demo.controller';
import { DevUserMiddleware } from './dev/dev-user.middleware';
import { FgaModule } from './fga/fga.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    FgaModule,
    AuthModule,
  ],
  controllers: [HealthController, DemoController],
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
