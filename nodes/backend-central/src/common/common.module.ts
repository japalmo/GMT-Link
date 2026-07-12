import { Global, Logger, Module } from '@nestjs/common';
import {
  BrevoEmailService,
  EmailService,
  NoopEmailService,
  SmtpEmailService,
} from './email.service';
import { OtpService } from './otp.service';

/**
 * Módulo global de utilidades transversales (§1.1).
 * Provee `EmailService` (interfaz enchufable §9) y `OtpService` (OTP de uso
 * general: métricas, cambio de correo/contraseña). Al ser `@Global`, ambos quedan
 * inyectables en todo el grafo sin re-importar el módulo.
 *
 * Selección del proveedor de correo por prioridad (pivote anti-Railway):
 *  1. `BREVO_API_KEY` → `BrevoEmailService` (API HTTP; Railway bloquea SMTP saliente).
 *  2. `SMTP_HOST`     → `SmtpEmailService` (SMTP directo, para hosts que sí lo permiten).
 *  3. ninguno         → `NoopEmailService` (no se envían correos).
 * El proveedor activo se loguea al arrancar.
 */
@Global()
@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: (): EmailService => {
        const logger = new Logger('EmailServiceFactory');
        const brevoKey = process.env.BREVO_API_KEY;
        if (brevoKey && brevoKey.trim().length > 0) {
          logger.log('Proveedor de correo activo: BrevoEmailService (API HTTP de Brevo).');
          return new BrevoEmailService();
        }
        const host = process.env.SMTP_HOST;
        if (host && host.trim().length > 0) {
          logger.log('Proveedor de correo activo: SmtpEmailService (SMTP).');
          return new SmtpEmailService();
        }
        logger.log('Proveedor de correo activo: NoopEmailService (sin envío de correos).');
        return new NoopEmailService();
      },
    },
    OtpService,
  ],
  exports: [EmailService, OtpService],
})
export class CommonModule {}
