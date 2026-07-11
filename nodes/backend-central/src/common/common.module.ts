import { Global, Module } from '@nestjs/common';
import { EmailService, NoopEmailService, SmtpEmailService } from './email.service';
import { OtpService } from './otp.service';

/**
 * Módulo global de utilidades transversales (§1.1).
 * Provee `EmailService` (interfaz enchufable §9) y `OtpService` (OTP de uso
 * general: métricas, cambio de correo/contraseña). Al ser `@Global`, ambos quedan
 * inyectables en todo el grafo sin re-importar el módulo.
 * Si `SMTP_HOST` está configurado en el entorno, usa `SmtpEmailService`, de lo contrario cae a `NoopEmailService`.
 */
@Global()
@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: () => {
        const host = process.env.SMTP_HOST;
        if (host && host.trim().length > 0) {
          return new SmtpEmailService();
        }
        return new NoopEmailService();
      },
    },
    OtpService,
  ],
  exports: [EmailService, OtpService],
})
export class CommonModule {}
