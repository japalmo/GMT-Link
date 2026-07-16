import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SignaturesController } from './signatures.controller';
import { WebAuthnService } from './webauthn.service';

/**
 * Firma verificada (#68). Fase 1: registro de dispositivos WebAuthn. Exporta
 * `WebAuthnService` para que la Fase 2 (firmar checklists) lo consuma.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SignaturesController],
  providers: [WebAuthnService],
  exports: [WebAuthnService],
})
export class SignaturesModule {}
