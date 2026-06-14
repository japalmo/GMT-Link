import { Global, Module } from '@nestjs/common';
import { EmailService, NoopEmailService } from './email.service';

/**
 * Módulo global de utilidades transversales (§1.1).
 * Provee `EmailService` (interfaz enchufable §9) ligado por ahora al no-op.
 * Cuando se integre un proveedor real (SendGrid/SES/…) se cambia solo el
 * `useClass` aquí; los consumidores inyectan el token abstracto `EmailService`.
 */
@Global()
@Module({
  providers: [{ provide: EmailService, useClass: NoopEmailService }],
  exports: [EmailService],
})
export class CommonModule {}
