import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SignaturesController } from './signatures.controller';
import { WebAuthnService } from './webauthn.service';
import { SignatureService } from './signature.service';

/**
 * Firma verificada (#68). Registro de dispositivos WebAuthn (Fase 1) + firma de
 * artefactos con biometría u OTP (Fase 2). Exporta `SignatureService` (y
 * `WebAuthnService`) para que los módulos que firman (assets/checklists) los usen.
 * `OtpService`/`EmailService` son globales (CommonModule), no requieren import.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SignaturesController],
  providers: [WebAuthnService, SignatureService],
  exports: [WebAuthnService, SignatureService],
})
export class SignaturesModule {}
