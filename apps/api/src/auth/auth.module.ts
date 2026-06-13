import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { FirebaseService } from './firebase.service';

/**
 * Módulo de autenticación (Etapa 0.5). Provee `FirebaseService` (wrapper de
 * firebase-admin) y expone el `AuthController`. `PrismaModule` es global, pero
 * se importa explícitamente para dejar la dependencia documentada. El
 * `SessionMiddleware` se registra en `AppModule.configure` (necesita aplicarse
 * a todas las rutas, no solo a las de este módulo).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class AuthModule {}
