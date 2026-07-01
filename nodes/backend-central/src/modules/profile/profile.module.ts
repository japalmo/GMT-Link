import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Módulo de perfil propio (§6-1.3 "Mis datos").
 * Consume `PrismaService` (global) para leer y actualizar datos del usuario,
 * incluido el cambio de contraseña (bcrypt → passwordHash). No requiere
 * `AuthModule`. No requiere `FgaModule`: los endpoints son
 * autenticados sobre el propio usuario, sin permiso FGA que verificar.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
