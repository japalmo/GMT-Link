import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Módulo de perfil propio (§6-1.3 "Mis datos").
 * Consume `PrismaService` (global) y `FirebaseService` (de `AuthModule`, para
 * cambiar la clave del propio usuario). No requiere `FgaModule`: los endpoints
 * son autenticados sobre el propio usuario, sin permiso FGA que verificar.
 */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
