import { Global, Module } from '@nestjs/common';
import { EmailService, NoopEmailService, SmtpEmailService } from './email.service';

/**
 * Módulo global de utilidades transversales (§1.1).
 * Provee `EmailService` (interfaz enchufable §9).
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
  ],
  exports: [EmailService],
})
export class CommonModule {}
