import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Módulo de provisión de usuarios (§1.1).
 * Consume `FirebaseService` (de `AuthModule`), `PrismaService` (global) y
 * `FgaService` (global, vía `FgaModule`). `PermissionsGuard` es global (APP_GUARD
 * en AppModule), por lo que los `@RequirePermission` de este controller se
 * aplican sin registrar nada extra aquí.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
