import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PermissionsGuard } from './authz/permissions.guard';
import { DemoController } from './demo/demo.controller';
import { DevUserMiddleware } from './dev/dev-user.middleware';
import { FgaModule } from './fga/fga.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    FgaModule,
  ],
  controllers: [HealthController, DemoController],
  providers: [{ provide: APP_GUARD, useClass: PermissionsGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '{*path}' = comodín "todas las rutas" en path-to-regexp v8 (Express 5 / Nest 11),
    // equivalente moderno del legacy '*'.
    consumer.apply(DevUserMiddleware).forRoutes('{*path}');
  }
}
