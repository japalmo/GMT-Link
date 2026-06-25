import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/** Mensaje a enviar por un proveedor de email enchufable (§9). */
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Interfaz enchufable de envío de email (§9, decisión 1.1).
 *
 * DECISIÓN CERRADA: la provisión de usuarios NO envía email todavía; la clave
 * provisoria se RETORNA en la respuesta para que el admin la comparta. Este
 * contrato existe para enchufar un proveedor real (SendGrid/SES/…) más adelante
 * sin tocar la lógica de negocio: cuando exista, se cambia el provider que
 * satisface `EmailService` por una implementación real.
 */
export abstract class EmailService {
  abstract send(message: EmailMessage): Promise<void>;
}

/**
 * Implementación por defecto: NO envía nada (solo registra en debug).
 * Es el placeholder hasta integrar un proveedor (§9). Mantener este no-op evita
 * que el resto del código dependa de un proveedor inexistente.
 */
@Injectable()
export class NoopEmailService extends EmailService {
  private readonly logger = new Logger(NoopEmailService.name);

  send(message: EmailMessage): Promise<void> {
    this.logger.debug(
      `EmailService no integrado (§9): se omite envío a ${message.to} ("${message.subject}").`,
    );
    return Promise.resolve();
  }
}

/**
 * Implementación real usando SMTP (D6).
 * Se activa si están configuradas las variables de entorno SMTP en producción/desarrollo.
 */
@Injectable()
export class SmtpEmailService extends EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private readonly transporter: Transporter;

  constructor() {
    super();
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    const from = process.env.EMAIL_FROM || 'no-reply@gmt.cl';
    try {
      await this.transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      this.logger.log(`Email enviado con éxito a ${message.to}`);
    } catch (error) {
      this.logger.error(`Error al enviar email a ${message.to}:`, error);
      throw error;
    }
  }
}
